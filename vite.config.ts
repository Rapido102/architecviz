import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs/promises';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';
import { stripJsonComments } from './src/lib/stripJsonComments';

const ARCHITECTURES_DIR = path.resolve(__dirname, 'src/architectures');
const SAFE_FILENAME = /^[\w-]+\.jsonc?$/;

/** Transforms *.jsonc files into valid ES modules by stripping comments at build time. */
function jsoncPlugin(): Plugin {
  return {
    name: 'vite-plugin-jsonc',
    transform(code, id) {
      if (!id.endsWith('.jsonc')) return;

      const stripped = stripJsonComments(code);
      try {
        JSON.parse(stripped);
      } catch (e) {
        this.error(`Invalid JSONC in ${id}: ${e}`);
      }
      return { code: `export default ${stripped}`, map: null };
    },
  };
}

/**
 * Dev-only middleware: POST /api/save-architecture
 * Body: { fileName: string, content: string }
 * Writes content to src/architectures/{fileName} after validation.
 * Only active during `vite dev`.
 */
function saveArchitecturePlugin(): Plugin {
  return {
    name: 'vite-plugin-save-architecture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || req.url !== '/api/save-architecture') {
          return next();
        }

        res.setHeader('Content-Type', 'application/json');

        try {
          // Read body
          const body = await new Promise<string>((resolve, reject) => {
            let data = '';
            req.on('data', (chunk: Buffer) => (data += chunk.toString()));
            req.on('end', () => resolve(data));
            req.on('error', reject);
          });

          const { fileName, content } = JSON.parse(body) as {
            fileName: string;
            content: string;
          };

          // Security: filename must be safe (no traversal, correct extension)
          if (!fileName || !SAFE_FILENAME.test(fileName)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Nom de fichier invalide.' }));
            return;
          }

          // Security: resolved path must stay inside src/architectures/
          const target = path.resolve(ARCHITECTURES_DIR, fileName);
          if (!target.startsWith(ARCHITECTURES_DIR + path.sep) && target !== ARCHITECTURES_DIR) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Chemin non autorisé.' }));
            return;
          }

          // Validate: content must be parseable JSON (after stripping comments)
          const stripped = fileName.endsWith('.jsonc') ? stripJsonComments(content) : content;
          const parsed = JSON.parse(stripped); // throws if invalid

          // Structural guard: required top-level keys must be present
          const required = ['architecture', 'lastUpdated', 'description', 'components', 'connections'];
          const missing = required.filter(k => !(k in parsed));
          if (missing.length > 0) {
            res.statusCode = 422;
            res.end(JSON.stringify({ error: `Clés obligatoires manquantes : ${missing.join(', ')}` }));
            return;
          }

          await fs.writeFile(target, content, 'utf-8');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, path: target }));
        } catch (e: unknown) {
          const message = e instanceof SyntaxError
            ? 'JSON invalide — impossible de sauvegarder.'
            : String(e);
          res.statusCode = 400;
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [jsoncPlugin(), saveArchitecturePlugin(), react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

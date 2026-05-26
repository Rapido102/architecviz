import type { ArchitectureConfig } from '../types';

// Both .json and .jsonc are supported.
// .jsonc files are stripped of comments by the Vite jsoncPlugin at build time.
const jsonModules  = import.meta.glob('./*.json',  { eager: true }) as Record<string, { default: ArchitectureConfig }>;
const jsoncModules = import.meta.glob('./*.jsonc', { eager: true }) as Record<string, { default: ArchitectureConfig }>;

const modules: Record<string, { default: ArchitectureConfig }> = {
  ...jsonModules,
  ...jsoncModules,
};

export interface ArchitectureEntry {
  id: string;
  fileName: string;
  name: string;
  data: ArchitectureConfig;
}

export const architectures: ArchitectureEntry[] = Object.entries(modules)
  .map(([filePath, mod]) => {
    const fileName = filePath.replace(/^\.\//, '');
    const id = fileName.replace(/\.jsonc?$/, '');
    const data = mod.default;
    return {
      id,
      fileName,
      name: data.architecture || id,
      data,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

if (architectures.length === 0) {
  throw new Error(
    "Aucun fichier d'architecture trouvé. Ajoute au moins un .json ou .jsonc dans src/architectures/",
  );
}

export const defaultArchitecture: ArchitectureEntry = architectures[0];

import { useRef, useEffect } from 'react';
import { Editor, Monaco, OnMount, OnValidate } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { architectureSchema } from '../schema/architectureSchema';

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with schema error count whenever Monaco re-validates. */
  onValidate?: (errorCount: number) => void;
  /** Called when the user triggers Ctrl+S / Cmd+S inside the editor. */
  onSave?: () => void;
  /** Reveal + select the first occurrence of `text` (nonce forces re-trigger). */
  reveal?: { text: string; nonce: number } | null;
}

export function JsonEditor({ value, onChange, onValidate, onSave, reveal }: JsonEditorProps) {
  // Keep onSave in a ref so the Monaco command closure is never stale.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    const ed = editorRef.current;
    if (!reveal?.text || !ed) return;
    const model = ed.getModel();
    if (!model) return;
    const matches = model.findMatches(reveal.text, true, false, false, null, false);
    if (matches.length === 0) return;
    const range = matches[0].range;
    ed.revealRangeInCenterIfOutsideViewport(range);
    ed.setSelection(range);
    ed.focus();
  }, [reveal]);

  const handleBeforeMount = (monaco: Monaco) => {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: true,
      schemaValidation: 'error',
      schemas: [
        {
          uri: 'http://architectviz/schemas/architecture.json',
          fileMatch: ['*'],
          schema: architectureSchema as unknown as object,
        },
      ],
    });
  };

  const handleMount: OnMount = (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editorInstance;
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });
  };

  const handleValidate: OnValidate = (markers) => {
    const errors = markers.filter((m) => m.severity === 8); // MarkerSeverity.Error
    onValidate?.(errors.length);
  };

  return (
    <Editor
      height="100%"
      defaultLanguage="json"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      theme="vs-dark"
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      onValidate={handleValidate}
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace',
        fontLigatures: true,
        tabSize: 2,
        insertSpaces: true,
        formatOnPaste: true,
        formatOnType: true,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'on',
        bracketPairColorization: { enabled: true },
        guides: { indentation: true, bracketPairs: true },
        renderLineHighlight: 'gutter',
        smoothScrolling: true,
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
}

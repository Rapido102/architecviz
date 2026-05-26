import { useMemo, useState, useCallback } from 'react';
import { Save, CheckCircle, AlertCircle, X, Layers as LayersIcon, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { listSections } from '../../manifest/loader';
import type { ArchitectureConfig } from '../../types';
import { ManifestSectionForm, sectionIssueCounts } from './ManifestSectionForm';
import { SectionNav } from './SectionNav';
import { getAccessor } from './accessors';

interface Props {
  arch: ArchitectureConfig;
  onChange: (next: ArchitectureConfig) => void;
  onClose: () => void;
  onSave: () => Promise<void> | void;
  isDirty: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onReset: () => void;
  fileName: string;
}

const COMPONENT_TYPE_DEFAULTS: Record<string, Record<string, unknown>> = {
  components_frontend: { type: 'frontend', layer: 'Frontend' },
  components_backend: { type: 'backend', layer: 'Backend' },
  components_data: { type: 'db', layer: 'Data' },
  components_external: { type: 'third-party', layer: 'External' },
};

export function ArchitectureEditor({
  arch,
  onChange,
  onClose,
  onSave,
  isDirty,
  saveStatus,
  onReset,
  fileName,
}: Props) {
  const sections = useMemo(() => listSections(), []);
  const [activeSection, setActiveSection] = useState<string>('identity');

  const stats = useMemo(() => {
    const out: Record<string, { id: string; errors: number; warnings: number; count?: number }> = {};
    for (const section of sections) {
      const accessor = getAccessor(section.id);
      const value = accessor.read(arch);
      const { errors, warnings } = sectionIssueCounts(section, value);
      const count = Array.isArray(value) ? value.length : undefined;
      out[section.id] = { id: section.id, errors, warnings, count };
    }
    return out;
  }, [sections, arch]);

  const totalErrors = Object.values(stats).reduce((sum, s) => sum + s.errors, 0);

  const active = sections.find((s) => s.id === activeSection)!;
  const accessor = getAccessor(active.id);
  const value = accessor.read(arch);

  const handleSectionChange = useCallback(
    (next: unknown) => {
      onChange(accessor.write(arch, next));
    },
    [accessor, arch, onChange],
  );

  const canSave = isDirty && totalErrors === 0 && saveStatus !== 'saving';

  return (
    <div className="flex flex-col h-full w-full bg-white">
      {/* Header */}
      <header className="h-14 shrink-0 px-4 flex items-center justify-between border-b border-brand-line bg-white">
        <div className="flex items-center gap-3 min-w-0">
          <LayersIcon className="w-4 h-4 opacity-60 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xs font-mono uppercase font-bold leading-tight">
              Architecture Editor
              {isDirty && (
                <span
                  className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle"
                  title="Modifications non sauvegardées"
                />
              )}
            </h2>
            <p className="text-[10px] font-mono opacity-50 truncate">
              {fileName} · {totalErrors === 0 ? 'aucune erreur' : `${totalErrors} erreur(s) — save bloqué`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-green-600">
              <CheckCircle className="w-3 h-3" /> Enregistré
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-red-600">
              <AlertCircle className="w-3 h-3" /> Erreur
            </span>
          )}

          <button
            type="button"
            onClick={onReset}
            disabled={!isDirty}
            title="Annuler toutes les modifications non sauvegardées"
            className={cn(
              'flex items-center gap-1 px-2 h-7 text-[10px] font-mono uppercase border transition-all',
              isDirty
                ? 'border-brand-line hover:bg-brand-bg'
                : 'border-brand-line opacity-30 cursor-not-allowed',
            )}
          >
            <RotateCcw className="w-3 h-3" /> Annuler
          </button>

          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!canSave}
            title={
              totalErrors > 0
                ? `${totalErrors} erreur(s) — corrige avant save`
                : !isDirty
                ? 'Aucune modification'
                : 'Sauvegarder (Ctrl+S)'
            }
            className={cn(
              'flex items-center gap-1.5 px-3 h-7 text-[10px] font-mono uppercase border transition-all',
              canSave
                ? 'border-amber-500 text-amber-700 hover:bg-amber-500 hover:text-white'
                : 'border-brand-line text-brand-line/60 cursor-not-allowed',
            )}
          >
            <Save className="w-3 h-3" />
            {saveStatus === 'saving' ? 'Saving…' : 'Save'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-brand-bg transition-colors"
            title="Fermer l'éditeur"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Body: nav + form */}
      <div className="flex-1 flex min-h-0">
        <SectionNav
          sections={sections}
          active={activeSection}
          onSelect={setActiveSection}
          stats={stats}
        />
        <div className="flex-1 overflow-y-auto p-6">
          <ManifestSectionForm
            section={active}
            value={value}
            onChange={handleSectionChange}
            arch={arch}
            defaultsForNewItem={COMPONENT_TYPE_DEFAULTS[active.id]}
          />
        </div>
      </div>
    </div>
  );
}

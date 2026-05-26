import { useMemo } from 'react';
import { AlertCircle, Info, Wand2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { FieldSpec } from '../../manifest/types';
import { validateField } from '../../manifest/validation';
import type { ArchitectureConfig } from '../../types';

interface Props {
  fieldName: string;
  spec: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  arch: ArchitectureConfig;
  path: string;
  compact?: boolean;
}

function resolveRefersTo(refersTo: string, arch: ArchitectureConfig): string[] {
  // Supported simple refs: $.layers[].name, $.components[].id
  if (refersTo === '$.layers[].name') {
    return (arch.layers ?? []).map((l) => l.name);
  }
  if (refersTo === '$.components[].id') {
    return (arch.components ?? []).map((c) => c.id);
  }
  return [];
}

function humanLabel(fieldName: string): string {
  return fieldName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ManifestField({ fieldName, spec, value, onChange, arch, path, compact }: Props) {
  const validation = spec.validation;
  const issues = useMemo(() => validateField(value, validation, path), [value, validation, path]);
  const hasError = issues.some((i) => i.severity === 'error');

  const refOptions = useMemo(() => {
    if (!validation?.refers_to) return null;
    return resolveRefersTo(validation.refers_to, arch);
  }, [validation?.refers_to, arch]);

  const type = validation?.type ?? 'string';
  const label = humanLabel(fieldName);
  const isLongString =
    type === 'string' && (validation?.max_length ?? 0) > 100 || fieldName === 'description' || fieldName === 'note' || fieldName === 'suggestion' || fieldName === 'purpose';

  const baseInputClass = cn(
    'w-full px-2 py-1.5 text-xs border bg-white focus:outline-none focus:border-brand-ink transition-colors',
    hasError ? 'border-red-500' : 'border-brand-line',
  );

  const inputId = path.replace(/[^a-z0-9]/gi, '_');

  // === Render the input ===
  let inputEl: React.ReactNode;

  if (refOptions && refOptions.length > 0) {
    inputEl = (
      <select
        id={inputId}
        className={baseInputClass}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— sélectionner —</option>
        {refOptions.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  } else if (validation?.enum) {
    inputEl = (
      <select
        id={inputId}
        className={baseInputClass}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {validation.enum.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  } else if (type === 'boolean') {
    inputEl = (
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          id={inputId}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 accent-brand-ink"
        />
        <span className="opacity-70">{value ? 'oui' : 'non'}</span>
      </label>
    );
  } else if (type === 'integer') {
    inputEl = (
      <input
        id={inputId}
        type="number"
        className={baseInputClass}
        value={typeof value === 'number' ? value : ''}
        min={validation?.minimum}
        max={validation?.maximum}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? undefined : Number(v));
        }}
      />
    );
  } else if (type === 'array' && validation?.items?.pattern) {
    // Array of primitive strings (e.g., api_calls: ["GET /api/..."], key_dependencies)
    inputEl = (
      <StringArrayInput
        id={inputId}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        pattern={validation.items.pattern}
        placeholder={spec.extractor_rules?.[1] ?? 'valeur — Entrée pour ajouter'}
        hasError={hasError}
      />
    );
  } else if (type === 'array') {
    inputEl = (
      <StringArrayInput
        id={inputId}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        placeholder="valeur — Entrée pour ajouter"
        hasError={hasError}
      />
    );
  } else if (fieldName === 'color') {
    inputEl = (
      <div className="flex gap-2">
        <input
          type="color"
          className="w-12 h-8 border border-brand-line cursor-pointer"
          value={typeof value === 'string' ? value : '#cccccc'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          id={inputId}
          type="text"
          className={baseInputClass}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#RRGGBB"
        />
      </div>
    );
  } else if (isLongString) {
    inputEl = (
      <textarea
        id={inputId}
        className={cn(baseInputClass, 'resize-y min-h-[60px]')}
        rows={2}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    inputEl = (
      <input
        id={inputId}
        type="text"
        className={baseInputClass}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={validation?.pattern ? `/${validation.pattern}/` : undefined}
      />
    );
  }

  return (
    <div className={cn('space-y-1', compact ? 'mb-2' : 'mb-3')}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-[10px] font-mono uppercase opacity-60 flex items-center gap-1">
          {label}
          {validation?.required && <span className="text-red-500">*</span>}
        </label>
        {spec.ai_prompt_hint && (
          <span
            className="flex items-center gap-1 text-[9px] font-mono opacity-40 hover:opacity-80 cursor-help"
            title={spec.ai_prompt_hint}
          >
            <Wand2 className="w-3 h-3" />
            ia
          </span>
        )}
      </div>
      {inputEl}
      {spec.purpose && !compact && (
        <div className="flex items-start gap-1 text-[10px] opacity-50 leading-tight">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{spec.purpose}</span>
        </div>
      )}
      {issues.map((issue, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-1 text-[10px]',
            issue.severity === 'error' ? 'text-red-600' : 'text-amber-600',
          )}
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function StringArrayInput({
  id,
  value,
  onChange,
  pattern,
  placeholder,
  hasError,
}: {
  id: string;
  value: string[];
  onChange: (next: unknown) => void;
  pattern?: string;
  placeholder?: string;
  hasError?: boolean;
}) {
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (value.includes(v)) return;
    onChange([...value, v]);
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {value.map((item, idx) => {
          const valid = !pattern || new RegExp(pattern).test(item);
          return (
            <span
              key={idx}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono border',
                valid ? 'bg-brand-bg border-brand-line' : 'bg-red-50 border-red-300 text-red-700',
              )}
            >
              {item}
              <button
                type="button"
                onClick={() => remove(idx)}
                className="opacity-50 hover:opacity-100"
                title="Supprimer"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        className={cn(
          'w-full px-2 py-1 text-[11px] border bg-white focus:outline-none focus:border-brand-ink',
          hasError ? 'border-red-500' : 'border-brand-line',
        )}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
    </div>
  );
}

import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, Copy } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { FieldSpec } from '../../manifest/types';
import { validateAgainstFields, validateUnique, countErrors } from '../../manifest/validation';
import type { ArchitectureConfig } from '../../types';
import { ItemFieldsForm } from './ItemFieldsForm';

interface Props {
  itemFields: Record<string, FieldSpec>;
  items: Record<string, unknown>[];
  onChange: (next: Record<string, unknown>[]) => void;
  identity: string[];
  arch: ArchitectureConfig;
  basePath: string;
  itemDefaults?: Record<string, unknown>;
  labelFn?: (item: Record<string, unknown>, idx: number) => string;
  itemLabel?: string;
}

function defaultsFromFields(itemFields: Record<string, FieldSpec>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(itemFields)) {
    if (spec.validation?.required) {
      const t = spec.validation.type ?? 'string';
      if (t === 'string') out[name] = '';
      else if (t === 'integer') out[name] = 0;
      else if (t === 'boolean') out[name] = false;
      else if (t === 'array') out[name] = [];
    }
  }
  return out;
}

export function ArrayFieldList({
  itemFields,
  items,
  onChange,
  identity,
  arch,
  basePath,
  itemDefaults,
  labelFn,
  itemLabel = 'élément',
}: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  const uniquenessIssues = validateUnique(items, identity, basePath);

  const toggleExpanded = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const updateItem = (idx: number, next: Record<string, unknown>) => {
    onChange(items.map((item, i) => (i === idx ? next : item)));
  };

  const removeItem = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
    setExpanded((prev) => {
      const next = new Set<number>();
      prev.forEach((e) => {
        if (e < idx) next.add(e);
        else if (e > idx) next.add(e - 1);
      });
      return next;
    });
  };

  const duplicateItem = (idx: number) => {
    const source = items[idx];
    const copy = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
    // Mark identity fields as needing edit
    identity.forEach((k) => {
      if (typeof copy[k] === 'string') copy[k] = `${copy[k]}_copy`;
    });
    onChange([...items.slice(0, idx + 1), copy, ...items.slice(idx + 1)]);
  };

  const addItem = () => {
    const next = { ...defaultsFromFields(itemFields), ...itemDefaults };
    onChange([...items, next]);
    setExpanded((prev) => new Set([...prev, items.length]));
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <div className="text-[11px] opacity-50 italic p-3 border border-dashed border-brand-line text-center">
          Aucun {itemLabel} — clique sur « Ajouter » pour commencer.
        </div>
      )}

      {items.map((item, idx) => {
        const isOpen = expanded.has(idx);
        const itemIssues = validateAgainstFields(item, itemFields, `${basePath}[${idx}]`);
        const dupIssues = uniquenessIssues.filter((i) => i.path === `${basePath}[${idx}]`);
        const errorCount = countErrors(itemIssues) + dupIssues.length;
        const label =
          labelFn?.(item, idx) ??
          (typeof item.id === 'string' ? item.id : null) ??
          (typeof item.name === 'string' ? item.name : null) ??
          (typeof item.path === 'string' ? item.path : null) ??
          (typeof item.message === 'string' ? item.message : null) ??
          `${itemLabel} #${idx + 1}`;

        return (
          <div
            key={idx}
            className={cn(
              'border bg-white',
              errorCount > 0 ? 'border-red-300' : 'border-brand-line',
            )}
          >
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-brand-line bg-brand-bg">
              <button
                type="button"
                onClick={() => toggleExpanded(idx)}
                className="flex items-center gap-1 text-xs font-mono flex-1 min-w-0 text-left"
              >
                {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                <span className="truncate">{String(label)}</span>
                {errorCount > 0 && (
                  <span className="ml-1 px-1 text-[9px] bg-red-500 text-white">{errorCount}</span>
                )}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => duplicateItem(idx)}
                  className="p-1 opacity-50 hover:opacity-100 transition-opacity"
                  title="Dupliquer"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="p-1 opacity-50 hover:text-red-600 hover:opacity-100 transition-opacity"
                  title="Supprimer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="p-3 space-y-2">
                {dupIssues.map((iss, i) => (
                  <div key={i} className="text-[10px] text-red-600 bg-red-50 p-2 border border-red-200">
                    {iss.message}
                  </div>
                ))}
                <ItemFieldsForm
                  itemFields={itemFields}
                  item={item}
                  onChange={(next) => updateItem(idx, next)}
                  arch={arch}
                  basePath={`${basePath}[${idx}]`}
                />
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addItem}
        className="flex items-center justify-center gap-1 w-full py-1.5 text-[10px] font-mono uppercase border border-dashed border-brand-line hover:border-brand-ink hover:bg-brand-bg transition-colors"
      >
        <Plus className="w-3 h-3" /> Ajouter {itemLabel}
      </button>
    </div>
  );
}

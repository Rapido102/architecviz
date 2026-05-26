import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ManifestSection } from '../../manifest/types';
import { validateAgainstFields, countErrors, countWarnings } from '../../manifest/validation';
import type { ArchitectureConfig } from '../../types';
import { ManifestField } from './ManifestField';
import { ArrayFieldList } from './ArrayFieldList';
import { ItemFieldsForm } from './ItemFieldsForm';
import { ObjectFieldForm } from './ObjectFieldForm';

interface Props {
  section: ManifestSection;
  value: unknown;
  onChange: (next: unknown) => void;
  arch: ArchitectureConfig;
  defaultsForNewItem?: Record<string, unknown>;
}

export function ManifestSectionForm({ section, value, onChange, arch, defaultsForNewItem }: Props) {
  const isList = !!section.item_fields;

  const issues = useMemo(() => {
    if (isList && Array.isArray(value)) {
      const out = value.flatMap((item, idx) =>
        typeof item === 'object' && item !== null
          ? validateAgainstFields(item as Record<string, unknown>, section.item_fields!, `$[${idx}]`)
          : [],
      );
      return out;
    }
    if (section.fields && value && typeof value === 'object') {
      return validateAgainstFields(value as Record<string, unknown>, section.fields, '$');
    }
    return [];
  }, [value, section, isList]);

  const errors = countErrors(issues);
  const warnings = countWarnings(issues);

  return (
    <div className="space-y-4 max-w-3xl">
      <header className="space-y-1 pb-3 border-b border-brand-line">
        <h2 className="text-lg font-bold tracking-tight">{section.title}</h2>
        <p className="text-xs opacity-60 leading-snug">{section.scope}</p>
        <div className="flex items-center gap-3 text-[10px] font-mono opacity-50 pt-1">
          <span>#{section.order}</span>
          <span>passe : {section.extraction_pass}</span>
          {section.ai_prompt_ref && (
            <a
              href={`/${section.ai_prompt_ref}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 hover:opacity-100 hover:underline"
              title={section.ai_prompt_ref}
            >
              <Sparkles className="w-3 h-3" /> prompt
            </a>
          )}
          {(errors > 0 || warnings > 0) && (
            <span className="ml-auto flex items-center gap-2">
              {errors > 0 && <span className="text-red-600">{errors} erreur(s)</span>}
              {warnings > 0 && <span className="text-amber-600">{warnings} warning(s)</span>}
            </span>
          )}
        </div>
      </header>

      <SectionBody
        section={section}
        value={value}
        onChange={onChange}
        arch={arch}
        defaultsForNewItem={defaultsForNewItem}
      />
    </div>
  );
}

function SectionBody({ section, value, onChange, arch, defaultsForNewItem }: Props) {
  // List section (item_fields) → ArrayFieldList
  if (section.item_fields) {
    const identity = section.merge?.identity ?? ['id'];
    const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    return (
      <ArrayFieldList
        itemFields={section.item_fields}
        items={items}
        onChange={onChange}
        identity={identity}
        arch={arch}
        basePath="$"
        itemDefaults={defaultsForNewItem}
        itemLabel={itemLabelForSection(section.id)}
      />
    );
  }

  // Object section (fields) → render each field; sub_fields handled recursively
  if (section.fields) {
    const obj = (value as Record<string, unknown>) ?? {};
    return (
      <div className="space-y-2">
        {Object.entries(section.fields).map(([fieldName, spec]) => {
          if (spec.sub_fields) {
            return (
              <div key={fieldName} className="space-y-1">
                <div className="text-[10px] font-mono uppercase opacity-60">
                  {fieldName.replace(/_/g, ' ')}
                </div>
                <ObjectFieldForm
                  subFields={spec.sub_fields}
                  value={(obj[fieldName] as Record<string, unknown>) ?? {}}
                  onChange={(next) => onChange({ ...obj, [fieldName]: next })}
                  arch={arch}
                  basePath={`$.${fieldName}`}
                />
              </div>
            );
          }
          if (spec.item_fields) {
            return (
              <div key={fieldName} className="space-y-1">
                <div className="text-[10px] font-mono uppercase opacity-60">
                  {fieldName.replace(/_/g, ' ')}
                </div>
                <ArrayFieldList
                  itemFields={spec.item_fields}
                  items={Array.isArray(obj[fieldName]) ? (obj[fieldName] as Record<string, unknown>[]) : []}
                  onChange={(next) => onChange({ ...obj, [fieldName]: next })}
                  identity={
                    typeof spec.merge === 'object' && spec.merge?.identity ? spec.merge.identity : ['id']
                  }
                  arch={arch}
                  basePath={`$.${fieldName}`}
                />
              </div>
            );
          }
          return (
            <ManifestField
              key={fieldName}
              fieldName={fieldName}
              spec={spec}
              value={obj[fieldName]}
              onChange={(v) => onChange({ ...obj, [fieldName]: v })}
              arch={arch}
              path={`$.${fieldName}`}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('text-[11px] opacity-60 italic p-3 border border-dashed border-brand-line')}>
      Section calculée / sans champs éditables.
    </div>
  );
}

function itemLabelForSection(id: string): string {
  if (id === 'layers') return 'couche';
  if (id === 'connections') return 'connexion';
  if (id.startsWith('components_')) return 'composant';
  return 'élément';
}

// Export accessory used by SectionNav to compute error counts.
export function sectionIssueCounts(section: ManifestSection, value: unknown) {
  let issues: ReturnType<typeof validateAgainstFields> = [];
  if (section.item_fields && Array.isArray(value)) {
    issues = value.flatMap((item, idx) =>
      typeof item === 'object' && item !== null
        ? validateAgainstFields(item as Record<string, unknown>, section.item_fields!, `$[${idx}]`)
        : [],
    );
  } else if (section.fields && value && typeof value === 'object') {
    issues = validateAgainstFields(value as Record<string, unknown>, section.fields, '$');
  }
  return { errors: countErrors(issues), warnings: countWarnings(issues) };
}

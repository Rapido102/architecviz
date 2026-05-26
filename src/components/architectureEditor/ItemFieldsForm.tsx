import type { FieldSpec } from '../../manifest/types';
import type { ArchitectureConfig } from '../../types';
import { ManifestField } from './ManifestField';
import { ArrayFieldList } from './ArrayFieldList';
import { ObjectFieldForm } from './ObjectFieldForm';

interface Props {
  itemFields: Record<string, FieldSpec>;
  item: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  arch: ArchitectureConfig;
  basePath: string;
}

export function ItemFieldsForm({ itemFields, item, onChange, arch, basePath }: Props) {
  const update = (fieldName: string, value: unknown) => {
    onChange({ ...item, [fieldName]: value });
  };

  return (
    <div className="space-y-2">
      {Object.entries(itemFields).map(([fieldName, spec]) => {
        const value = item[fieldName];

        // Nested array with item_fields → recursive ArrayFieldList
        if (spec.item_fields) {
          const subIdentity =
            typeof spec.merge === 'object' && spec.merge?.identity ? spec.merge.identity : ['id'];
          return (
            <div key={fieldName} className="space-y-1">
              <div className="text-[10px] font-mono uppercase opacity-60">
                {fieldName.replace(/_/g, ' ')}
                {Array.isArray(value) && value.length > 0 && (
                  <span className="ml-2 opacity-50">({value.length})</span>
                )}
              </div>
              {spec.purpose && (
                <div className="text-[10px] opacity-50 leading-tight mb-1">{spec.purpose}</div>
              )}
              <ArrayFieldList
                itemFields={spec.item_fields}
                items={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
                onChange={(next) => update(fieldName, next)}
                identity={subIdentity}
                arch={arch}
                basePath={`${basePath}.${fieldName}`}
                itemLabel={singularize(fieldName)}
              />
            </div>
          );
        }

        // Nested object with sub_fields → ObjectFieldForm
        if (spec.sub_fields) {
          return (
            <div key={fieldName} className="space-y-1">
              <div className="text-[10px] font-mono uppercase opacity-60">
                {fieldName.replace(/_/g, ' ')}
              </div>
              <ObjectFieldForm
                subFields={spec.sub_fields}
                value={(value as Record<string, unknown>) ?? {}}
                onChange={(next) => update(fieldName, next)}
                arch={arch}
                basePath={`${basePath}.${fieldName}`}
              />
            </div>
          );
        }

        return (
          <ManifestField
            key={fieldName}
            fieldName={fieldName}
            spec={spec}
            value={value}
            onChange={(v) => update(fieldName, v)}
            arch={arch}
            path={`${basePath}.${fieldName}`}
            compact
          />
        );
      })}
    </div>
  );
}

function singularize(name: string): string {
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
  if (name.endsWith('s')) return name.slice(0, -1);
  return name;
}

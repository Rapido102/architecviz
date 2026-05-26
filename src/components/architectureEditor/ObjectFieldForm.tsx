import type { FieldSpec } from '../../manifest/types';
import type { ArchitectureConfig } from '../../types';
import { ManifestField } from './ManifestField';

interface Props {
  subFields: Record<string, FieldSpec>;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  arch: ArchitectureConfig;
  basePath: string;
}

export function ObjectFieldForm({ subFields, value, onChange, arch, basePath }: Props) {
  const update = (fieldName: string, v: unknown) => {
    onChange({ ...value, [fieldName]: v });
  };

  return (
    <div className="border border-brand-line bg-brand-bg/40 p-3 space-y-2">
      {Object.entries(subFields).map(([fieldName, spec]) => (
        <ManifestField
          key={fieldName}
          fieldName={fieldName}
          spec={spec}
          value={value[fieldName]}
          onChange={(v) => update(fieldName, v)}
          arch={arch}
          path={`${basePath}.${fieldName}`}
          compact
        />
      ))}
    </div>
  );
}

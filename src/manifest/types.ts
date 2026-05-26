export type FieldType = 'string' | 'integer' | 'boolean' | 'array' | 'object';

export interface ValidationRule {
  type?: FieldType;
  required?: boolean;
  enum?: readonly string[];
  pattern?: string;
  min_length?: number;
  max_length?: number;
  minimum?: number;
  maximum?: number;
  refers_to?: string;
  items?: { type?: string; pattern?: string };
}

export interface FieldSpec {
  purpose?: string;
  sources?: unknown;
  extractor?: string | null;
  extractor_rules?: string[];
  ai_prompt_hint?: string;
  ai_prompt_ref?: string;
  validation?: ValidationRule;
  merge?: string | { strategy?: string; identity?: string[] };
  default_on_create?: unknown;
  item_fields?: Record<string, FieldSpec>;
  sub_fields?: Record<string, FieldSpec>;
}

export interface ManifestSection {
  id: string;
  order: number;
  title: string;
  scope: string;
  extraction_pass: string;
  ai_prompt_ref?: string;
  json_path?: string;
  merge?: { strategy?: string; identity?: string[] };
  static_default?: unknown[];
  fields?: Record<string, FieldSpec>;
  item_fields?: Record<string, FieldSpec>;
}

export interface Manifest {
  $manifest: string;
  version: string;
  applies_to: string;
  global: {
    missing_placeholder: string;
    overwrite_placeholder: boolean;
    warn_on_placeholder: boolean;
    manual_fields_global: string[];
    ai_confidence_threshold_default: number;
  };
  sections: ManifestSection[];
}

import type { FieldSpec, ValidationRule } from './types';

export interface ValidationIssue {
  path: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

const MISSING = 'À confirmer';

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export function validateField(value: unknown, rule: ValidationRule | undefined, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!rule) return issues;

  const empty = isMissing(value);
  if (rule.required && empty) {
    issues.push({ path, rule: 'required', message: `Champ requis`, severity: 'error' });
    return issues;
  }
  if (empty) return issues;

  if (rule.type === 'string' && typeof value !== 'string') {
    issues.push({ path, rule: 'type', message: `Attendu string`, severity: 'error' });
    return issues;
  }
  if (rule.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
    issues.push({ path, rule: 'type', message: `Attendu entier`, severity: 'error' });
  }
  if (rule.type === 'boolean' && typeof value !== 'boolean') {
    issues.push({ path, rule: 'type', message: `Attendu booléen`, severity: 'error' });
  }
  if (rule.type === 'array' && !Array.isArray(value)) {
    issues.push({ path, rule: 'type', message: `Attendu liste`, severity: 'error' });
    return issues;
  }

  if (typeof value === 'string') {
    // "À confirmer" is the missing-placeholder — flag as warning so the user knows to complete.
    if (value === MISSING) {
      issues.push({ path, rule: 'placeholder', message: `Valeur à confirmer`, severity: 'warning' });
    }
    if (rule.enum && !rule.enum.includes(value)) {
      issues.push({
        path,
        rule: 'enum',
        message: `Hors valeurs : ${rule.enum.join(' | ')}`,
        severity: 'error',
      });
    }
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
      issues.push({
        path,
        rule: 'pattern',
        message: `Format invalide (attendu : /${rule.pattern}/)`,
        severity: 'error',
      });
    }
    if (rule.min_length !== undefined && value.length < rule.min_length) {
      issues.push({ path, rule: 'min_length', message: `Min ${rule.min_length} caractères`, severity: 'error' });
    }
    if (rule.max_length !== undefined && value.length > rule.max_length) {
      issues.push({ path, rule: 'max_length', message: `Max ${rule.max_length} caractères`, severity: 'error' });
    }
  }

  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) {
      issues.push({ path, rule: 'minimum', message: `Min ${rule.minimum}`, severity: 'error' });
    }
    if (rule.maximum !== undefined && value > rule.maximum) {
      issues.push({ path, rule: 'maximum', message: `Max ${rule.maximum}`, severity: 'error' });
    }
  }

  if (Array.isArray(value) && rule.items?.pattern) {
    const re = new RegExp(rule.items.pattern);
    value.forEach((item, idx) => {
      if (typeof item === 'string' && !re.test(item)) {
        issues.push({
          path: `${path}[${idx}]`,
          rule: 'items.pattern',
          message: `"${item}" — format invalide`,
          severity: 'error',
        });
      }
    });
  }

  return issues;
}

export function validateAgainstFields(
  obj: Record<string, unknown>,
  fields: Record<string, FieldSpec>,
  basePath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [fieldName, spec] of Object.entries(fields)) {
    const value = obj?.[fieldName];
    issues.push(...validateField(value, spec.validation, `${basePath}.${fieldName}`));

    // Recurse into nested item_fields (e.g., routes inside components)
    if (spec.item_fields && Array.isArray(value)) {
      value.forEach((item, idx) => {
        if (typeof item === 'object' && item !== null) {
          issues.push(
            ...validateAgainstFields(
              item as Record<string, unknown>,
              spec.item_fields as Record<string, FieldSpec>,
              `${basePath}.${fieldName}[${idx}]`,
            ),
          );
        }
      });
    }
    // Recurse into sub_fields (e.g., deployment, authentication)
    if (spec.sub_fields && value && typeof value === 'object' && !Array.isArray(value)) {
      issues.push(
        ...validateAgainstFields(
          value as Record<string, unknown>,
          spec.sub_fields as Record<string, FieldSpec>,
          `${basePath}.${fieldName}`,
        ),
      );
    }
  }
  return issues;
}

export function validateUnique(
  list: Record<string, unknown>[],
  identity: string[],
  basePath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, number>();
  list.forEach((item, idx) => {
    const key = identity.map((k) => JSON.stringify(item[k] ?? '')).join('|');
    if (key === identity.map(() => '""').join('|')) return; // skip all-empty
    const prev = seen.get(key);
    if (prev !== undefined) {
      issues.push({
        path: `${basePath}[${idx}]`,
        rule: 'identity',
        message: `Doublon (clé ${identity.join('+')} = item #${prev})`,
        severity: 'error',
      });
    } else {
      seen.set(key, idx);
    }
  });
  return issues;
}

export function countErrors(issues: ValidationIssue[]): number {
  return issues.filter((i) => i.severity === 'error').length;
}

export function countWarnings(issues: ValidationIssue[]): number {
  return issues.filter((i) => i.severity === 'warning').length;
}

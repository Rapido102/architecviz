import { getSection, ManifestSection } from './manifest-loader.js';

export interface ValidationIssue {
  path: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

interface FieldRule {
  validation?: {
    type?: 'string' | 'integer' | 'boolean' | 'array' | 'object';
    required?: boolean;
    enum?: string[];
    pattern?: string;
    min_length?: number;
    max_length?: number;
    minimum?: number;
    maximum?: number;
    items?: { type?: string; pattern?: string };
  };
}

function validateValue(value: unknown, rule: FieldRule | undefined, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const v = rule?.validation;
  if (!v) return issues;

  const isMissing = value === undefined || value === null || value === '';
  if (v.required && isMissing) {
    issues.push({ path, rule: 'required', message: `Champ requis manquant`, severity: 'error' });
    return issues;
  }
  if (isMissing) return issues;

  if (v.type === 'string' && typeof value !== 'string') {
    issues.push({ path, rule: 'type', message: `Attendu string, reçu ${typeof value}`, severity: 'error' });
    return issues;
  }
  if (v.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
    issues.push({ path, rule: 'type', message: `Attendu integer`, severity: 'error' });
  }
  if (v.type === 'boolean' && typeof value !== 'boolean') {
    issues.push({ path, rule: 'type', message: `Attendu boolean`, severity: 'error' });
  }
  if (v.type === 'array' && !Array.isArray(value)) {
    issues.push({ path, rule: 'type', message: `Attendu array`, severity: 'error' });
    return issues;
  }

  if (typeof value === 'string') {
    if (v.enum && !v.enum.includes(value)) {
      issues.push({
        path,
        rule: 'enum',
        message: `Valeur "${value}" hors enum [${v.enum.join(', ')}]`,
        severity: 'error',
      });
    }
    if (v.pattern && !new RegExp(v.pattern).test(value)) {
      issues.push({
        path,
        rule: 'pattern',
        message: `"${value}" ne matche pas /${v.pattern}/`,
        severity: 'error',
      });
    }
    if (v.min_length !== undefined && value.length < v.min_length) {
      issues.push({ path, rule: 'min_length', message: `Longueur < ${v.min_length}`, severity: 'error' });
    }
    if (v.max_length !== undefined && value.length > v.max_length) {
      issues.push({ path, rule: 'max_length', message: `Longueur > ${v.max_length}`, severity: 'error' });
    }
  }

  if (typeof value === 'number') {
    if (v.minimum !== undefined && value < v.minimum) {
      issues.push({ path, rule: 'minimum', message: `Valeur < ${v.minimum}`, severity: 'error' });
    }
    if (v.maximum !== undefined && value > v.maximum) {
      issues.push({ path, rule: 'maximum', message: `Valeur > ${v.maximum}`, severity: 'error' });
    }
  }

  if (Array.isArray(value) && v.items?.pattern) {
    const re = new RegExp(v.items.pattern);
    value.forEach((item, idx) => {
      if (typeof item === 'string' && !re.test(item)) {
        issues.push({
          path: `${path}[${idx}]`,
          rule: 'items.pattern',
          message: `"${item}" ne matche pas /${v.items!.pattern}/`,
          severity: 'error',
        });
      }
    });
  }

  return issues;
}

function validateAgainstFields(
  value: unknown,
  fields: Record<string, FieldRule>,
  basePath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof value !== 'object' || value === null) {
    issues.push({ path: basePath, rule: 'type', message: 'Attendu objet', severity: 'error' });
    return issues;
  }
  const obj = value as Record<string, unknown>;
  for (const [field, rule] of Object.entries(fields)) {
    issues.push(...validateValue(obj[field], rule, `${basePath}.${field}`));
  }
  return issues;
}

export function validateFragment(sectionId: string, fragment: unknown): ValidationIssue[] {
  const section = getSection(sectionId);
  const issues: ValidationIssue[] = [];

  if (section.item_fields) {
    if (!Array.isArray(fragment)) {
      issues.push({
        path: '$',
        rule: 'shape',
        message: `Section "${sectionId}" attend un array de fragments`,
        severity: 'error',
      });
      return issues;
    }
    fragment.forEach((item, idx) => {
      issues.push(
        ...validateAgainstFields(
          item,
          section.item_fields as Record<string, FieldRule>,
          `$[${idx}]`,
        ),
      );
    });
  } else if (section.fields) {
    issues.push(
      ...validateAgainstFields(fragment, section.fields as Record<string, FieldRule>, '$'),
    );
  }

  return issues;
}

export function summarizeIssues(issues: ValidationIssue[]): string {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  if (errors === 0 && warnings === 0) return 'OK — fragment valide';
  return `${errors} erreur(s), ${warnings} warning(s)`;
}

// Avoid unused-imports lint on the type re-exported for callers.
export type { ManifestSection };

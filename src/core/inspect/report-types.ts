export type Severity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface Issue {
  severity: Severity;
  category: 'broken_ref' | 'security' | 'drift' | string;
  message: string;
  path: string;
  component?: string;
  suggestion?: string;
}

export interface CompletenessReport {
  overall_score: number; // 0-100
  breakdown: {
    endpoints_total: number;
    endpoints_with_data_access: number;
    endpoints_with_data_access_pct: number;
    routes_total: number;
    routes_with_api_calls: number;
    routes_with_api_calls_pct: number;
    components_total: number;
    components_with_description: number;
    components_with_description_pct: number;
    components_with_precise_versions: number;
    components_with_precise_versions_pct: number;
    tables_total: number;
    tables_with_purpose: number;
    tables_with_purpose_pct: number;
    placeholder_count: number;
    sample_placeholder_paths: string[];
  };
}

export interface LineageReport {
  dead_tables: { component_id: string; name: string }[];
  hot_tables: { component_id: string; name: string; touched_by: number; via_endpoints: string[] }[];
  chatty_endpoints: { method: string; path: string; component: string; data_access_count: number }[];
  unauthenticated_endpoints_mutating: { method: string; path: string; component: string }[];
}

export interface InspectionReport {
  integrity: {
    issues: Issue[];
    summary: { critical: number; warnings: number; info: number };
  };
  completeness: CompletenessReport;
  lineage: LineageReport;
  query_result?: unknown;
}

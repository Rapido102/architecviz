import type { Provenance, Criticality } from './core/status';
export type { Provenance, Criticality } from './core/status';

export interface PayloadField {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
}

export interface ArchitectureConfig {
  architecture: string;
  type: string;
  version?: string;
  lastUpdated: string;
  description: string;
  layers?: Layer[];
  components: Component[];
  connections: Connection[];
  flow_summary?: FlowSummary;
  warnings?: Warning[];
  validation_checklist?: Record<string, string>;
  next_steps?: string[];
}

export interface Layer {
  name: string;
  color: string;
  description: string;
}

export type ComponentType =
  | "frontend"
  | "backend"
  | "cache"
  | "db"
  | "queue"
  | "mq"
  | "batch"
  | "etl"
  | "iam"
  | "monitoring"
  | "service"
  | "third-party";

export const COMPONENT_TYPES: readonly ComponentType[] = [
  "frontend",
  "backend",
  "cache",
  "db",
  "queue",
  "mq",
  "batch",
  "etl",
  "iam",
  "monitoring",
  "service",
  "third-party",
] as const;

export interface Component {
  id: string;
  label: string;
  type: ComponentType | string;
  layer: string;
  technology: string;
  url?: string;
  port?: number;
  deployment?: Deployment;
  description?: string;
  state_management?: string;
  build_tool?: string;
  routes?: Route[];
  key_dependencies?: string[];
  endpoints?: Endpoint[];
  authentication?: Authentication;
  consumed_via?: string;
  note?: string;
  /**
   * Explicit cross-architecture link: the canonical slug (file id) or `architecture`
   * name of another mapped architecture that this component represents.
   * Set by the MCP server; takes priority over heuristic matching in crossLinks.
   */
  external_ref?: string;
  cached_data?: CachedDataItem[];
  http_client_config?: Record<string, string>;
  used_by?: string[];
  tables?: Table[];
  // Organisation metadata — turns a technical map into an operational one.
  owner?: string;
  team?: string;
  criticality?: Criticality;
  environment?: string;
  // Provenance of this component's data (deterministic extractor / LLM / human).
  provenance?: Provenance;
  confidence?: number;
}

export interface Table {
  name: string;
  purpose?: string;
  note?: string;
}

export interface CachedDataItem {
  endpoint?: string;
  key_pattern: string;
  ttl: string;
  purpose: string;
}

export interface Deployment {
  platform: string;
  region?: string;
  ci_cd: string;
  module_federation?: string | boolean;
  containerized?: boolean;
  orchestration?: string;
  scaling?: string;
  note?: string;
}

export interface Route {
  path: string;
  label: string;
  authenticated: boolean;
  description: string;
  api_calls?: string[];
}

export interface Endpoint {
  path: string;
  method: string;
  description?: string;
  authenticated?: boolean;
  params?: Record<string, string[]>;
  response_schema?: string;
  status_codes?: number[];
  note?: string;
  mapped_from_frontend?: string;
  validation?: string;
  data_access?: DataAccess[];
  response_fields?: PayloadField[];
  request_fields?: PayloadField[];
  provenance?: Provenance;
  confidence?: number;
}

export interface DataAccess {
  component_id: string;
  resource: string;
  operation: string;
  note?: string;
  provenance?: Provenance;
  confidence?: number;
  /** Source evidence when auto-detected (file + matched snippet). */
  evidence?: string;
}

export interface Authentication {
  type: string;
  provider: string;
  token_expiry: string;
  roles_permissions: string;
  token_format: string;
  note?: string;
}

export interface Connection {
  id: string;
  from: string;
  to: string;
  protocol: string;
  authenticated: boolean;
  description: string;
  endpoints?: ConnectionEndpoint[];
  endpoint_mappings?: ConnectionEndpointMapping[];
  operations?: string[];
  ttl?: string;
  latency?: string;
  note?: string;
  client?: string;
  flow?: string;
  cached_endpoints?: any[];
  cache_strategy?: string;
}

export interface ConnectionEndpoint {
  frontend_call?: string;
  backend_endpoint: string;
  method: string;
  pages?: string[];
  query_params?: string[];
  description?: string;
  authenticated?: boolean;
}

export interface ConnectionEndpointMapping {
  frontend_endpoint: string;
  backend_endpoint: string;
  method: string;
  frontend_pages?: string[];
  purpose: string;
  query_params?: string;
  path_params?: string;
  request_body?: string;
  status?: string;
  authenticated?: boolean;
}

export interface FlowSummary {
  user_flow?: string;
  technologies_count: number;
  backend_endpoints: number;
  frontend_routes: number;
  external_services: number;
}

export interface Warning {
  severity: "WARNING" | "INFO" | "CRITICAL";
  message: string;
  component: string;
  suggestion: string;
}

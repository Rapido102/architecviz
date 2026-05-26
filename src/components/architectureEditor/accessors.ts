import type { ArchitectureConfig, Component } from '../../types';

export interface SectionAccessor {
  read: (arch: ArchitectureConfig) => unknown;
  write: (arch: ArchitectureConfig, value: unknown) => ArchitectureConfig;
}

function filterComponents(arch: ArchitectureConfig, predicate: (c: Component) => boolean): Component[] {
  return (arch.components ?? []).filter(predicate);
}

function replaceComponentSubset(
  arch: ArchitectureConfig,
  predicate: (c: Component) => boolean,
  next: Component[],
): ArchitectureConfig {
  const others = (arch.components ?? []).filter((c) => !predicate(c));
  return { ...arch, components: [...others, ...next] };
}

const FRONTEND = (c: Component) => c.type === 'frontend';
const BACKEND = (c: Component) => c.type === 'backend';
const DATA_TYPES = ['cache', 'db', 'queue', 'mq', 'etl', 'batch'];
const DATA = (c: Component) => DATA_TYPES.includes(c.type as string) || c.layer === 'Data';
const EXTERNAL_TYPES = ['iam', 'third-party', 'monitoring', 'service'];
const EXTERNAL = (c: Component) =>
  EXTERNAL_TYPES.includes(c.type as string) || c.layer === 'External';

export const accessors: Record<string, SectionAccessor> = {
  identity: {
    read: (a) => ({
      architecture: a.architecture ?? '',
      type: a.type ?? '',
      version: a.version ?? '',
      lastUpdated: a.lastUpdated ?? '',
      description: a.description ?? '',
    }),
    write: (a, v) => ({ ...a, ...(v as Partial<ArchitectureConfig>) }),
  },
  layers: {
    read: (a) => a.layers ?? [],
    write: (a, v) => ({ ...a, layers: v as ArchitectureConfig['layers'] }),
  },
  components_frontend: {
    read: (a) => filterComponents(a, FRONTEND),
    write: (a, v) => replaceComponentSubset(a, FRONTEND, v as Component[]),
  },
  components_backend: {
    read: (a) => filterComponents(a, BACKEND),
    write: (a, v) => replaceComponentSubset(a, BACKEND, v as Component[]),
  },
  components_data: {
    read: (a) => filterComponents(a, DATA),
    write: (a, v) => replaceComponentSubset(a, DATA, v as Component[]),
  },
  components_external: {
    read: (a) => filterComponents(a, EXTERNAL),
    write: (a, v) => replaceComponentSubset(a, EXTERNAL, v as Component[]),
  },
  connections: {
    read: (a) => a.connections ?? [],
    write: (a, v) => ({ ...a, connections: v as ArchitectureConfig['connections'] }),
  },
  flow_summary_and_warnings: {
    read: (a) => ({
      flow_summary: a.flow_summary ?? {
        user_flow: '',
        technologies_count: 0,
        backend_endpoints: 0,
        frontend_routes: 0,
        external_services: 0,
      },
      warnings: a.warnings ?? [],
    }),
    write: (a, v) => {
      const obj = v as { flow_summary?: ArchitectureConfig['flow_summary']; warnings?: ArchitectureConfig['warnings'] };
      return { ...a, flow_summary: obj.flow_summary, warnings: obj.warnings };
    },
  },
};

export function getAccessor(sectionId: string): SectionAccessor {
  const a = accessors[sectionId];
  if (!a) throw new Error(`No accessor for section "${sectionId}"`);
  return a;
}

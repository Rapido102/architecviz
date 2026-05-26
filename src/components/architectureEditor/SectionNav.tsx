import { cn } from '../../lib/utils';
import type { ManifestSection } from '../../manifest/types';

interface SectionStat {
  id: string;
  errors: number;
  warnings: number;
  count?: number;
}

interface Props {
  sections: ManifestSection[];
  active: string;
  onSelect: (id: string) => void;
  stats: Record<string, SectionStat>;
}

export function SectionNav({ sections, active, onSelect, stats }: Props) {
  return (
    <nav className="w-56 shrink-0 border-r border-brand-line bg-brand-bg/50 overflow-y-auto">
      <div className="px-3 pt-3 pb-2 text-[9px] font-mono uppercase opacity-50 tracking-wider">
        Sections
      </div>
      <ul>
        {sections.map((section) => {
          const stat = stats[section.id];
          const isActive = active === section.id;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                className={cn(
                  'w-full px-3 py-2 flex items-center gap-2 text-left text-xs border-l-2 transition-colors',
                  isActive
                    ? 'bg-white border-l-brand-ink font-semibold'
                    : 'border-l-transparent hover:bg-white/60',
                )}
              >
                <span className="text-[9px] font-mono opacity-40 w-3">{section.order}</span>
                <span className="flex-1 leading-tight">{section.title}</span>
                {typeof stat?.count === 'number' && stat.count > 0 && (
                  <span className="text-[9px] font-mono opacity-50">{stat.count}</span>
                )}
                {stat?.errors ? (
                  <span className="text-[9px] font-mono bg-red-500 text-white px-1">{stat.errors}</span>
                ) : null}
                {!stat?.errors && stat?.warnings ? (
                  <span className="text-[9px] font-mono bg-amber-400 text-black px-1">{stat.warnings}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

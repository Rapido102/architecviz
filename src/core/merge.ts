// Shared merge primitive: dedupe-by-identity list merge. Pure, framework-agnostic.

function makeKey(item: Record<string, unknown>, identity: string[]): string {
  return identity.map((k) => JSON.stringify(item[k] ?? '')).join('|');
}

export function mergeListByIdentity<T extends Record<string, unknown>>(
  base: T[],
  incoming: T[],
  identity: string[],
): { merged: T[]; added: number; updated: number } {
  const byKey = new Map<string, T>();
  base.forEach((item) => byKey.set(makeKey(item, identity), item));

  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const key = makeKey(item, identity);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      added++;
    } else {
      byKey.set(key, { ...existing, ...item });
      updated++;
    }
  }
  return { merged: Array.from(byKey.values()), added, updated };
}

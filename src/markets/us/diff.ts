import type { Change } from '../registry';
import type { UsExtraction } from './extract-schema';

type Indication = UsExtraction['indications'][number];
type Criterion = Indication['criteria'][number];

const SCALARS = ['title', 'payer', 'policy_number', 'effective_date', 'revision_date', 'auth_type'] as const;
const TEXT_LISTS = ['exclusions', 'documentation_requirements', 'site_of_care'] as const;

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
export const renderCriterion = (c: Criterion) => (c.any_of ? `${c.text} (any of: ${c.any_of.join('; ')})` : c.text);

function diffSets(field: string, before: string[], after: string[], key?: string): Change[] {
  const beforeByKey = new Map(before.map((v) => [normalize(v), v]));
  const afterByKey = new Map(after.map((v) => [normalize(v), v]));
  const removed = [...beforeByKey].filter(([k]) => !afterByKey.has(k)).map(([, v]) => v);
  const added = [...afterByKey].filter(([k]) => !beforeByKey.has(k)).map(([, v]) => v);
  return [
    ...removed.sort().map((v): Change => ({ field, kind: 'removed', ...(key ? { key } : {}), before: v })),
    ...added.sort().map((v): Change => ({ field, kind: 'added', ...(key ? { key } : {}), after: v })),
  ];
}

function diffCodes(before: UsExtraction['codes'], after: UsExtraction['codes']): Change[] {
  const keyOf = (c: UsExtraction['codes'][number]) => `${c.system} ${c.code}`;
  const beforeByKey = new Map(before.map((c) => [keyOf(c), c]));
  const afterByKey = new Map(after.map((c) => [keyOf(c), c]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  return keys.flatMap((key): Change[] => {
    const b = beforeByKey.get(key);
    const a = afterByKey.get(key);
    if (!b) return [{ field: 'codes', kind: 'added', key, after: a }];
    if (!a) return [{ field: 'codes', kind: 'removed', key, before: b }];
    if ((b.display ?? null) !== (a.display ?? null)) {
      return [{ field: 'codes', kind: 'changed', key, before: b.display ?? null, after: a.display ?? null }];
    }
    return [];
  });
}

function diffIndications(before: Indication[], after: Indication[]): Change[] {
  const beforeByKey = new Map(before.map((i) => [normalize(i.name), i]));
  const afterByKey = new Map(after.map((i) => [normalize(i.name), i]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  return keys.flatMap((k): Change[] => {
    const b = beforeByKey.get(k);
    const a = afterByKey.get(k);
    if (!b) return [{ field: 'indications', kind: 'added', key: a?.name, after: a }];
    if (!a) return [{ field: 'indications', kind: 'removed', key: b.name, before: b }];
    const match: Change[] =
      b.match === a.match ? [] : [{ field: 'indications.match', kind: 'changed', key: a.name, before: b.match, after: a.match }];
    return [...match, ...diffSets('criteria', b.criteria.map(renderCriterion), a.criteria.map(renderCriterion), a.name)];
  });
}

export function diffUsExtractions(previous: UsExtraction | null, next: UsExtraction): Change[] {
  const scalars = SCALARS.flatMap((field): Change[] => {
    const before = previous ? previous[field] : null;
    return before === next[field] ? [] : [{ field, kind: 'changed', before, after: next[field] }];
  });
  return [
    ...scalars,
    ...diffCodes(previous?.codes ?? [], next.codes),
    ...diffIndications(previous?.indications ?? [], next.indications),
    ...TEXT_LISTS.flatMap((field) => diffSets(field, previous?.[field] ?? [], next[field])),
  ];
}

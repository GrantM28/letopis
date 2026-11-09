// The discovery tree is sound: known ids, requirements that come earlier in history, every text present.
import { TECHS, TECH_BY_ID, eraOf } from '../src/server/sim/tech';
import { TECH_DESC, TECH_EN, TECH_LIST } from '../src/shared/i18n';
import { ERA_GATES } from '../src/shared/later_techs';

export function techtree() {
  const bad: string[] = [];
  const ids = new Set(TECHS.map((t) => t.id));
  if (ids.size !== TECHS.length) bad.push('two discoveries share an id');
  if (TECH_LIST.length !== TECHS.length) bad.push(`the page lists ${TECH_LIST.length} discoveries but the simulation has ${TECHS.length}`);
  for (const t of TECHS) {
    for (const r of t.prereq) {
      const p = TECH_BY_ID.get(r);
      if (!p) bad.push(`${t.id} needs unknown "${r}"`);
      else if (p.target > t.target) bad.push(`${t.id} (${t.target}) needs ${r}, which comes later (${p.target})`);
    }
    const en = TECH_EN[t.id];
    if (!en?.name || !en.text || !en.kids) bad.push(`${t.id} misses English name, text or kids' line`);
    if (!TECH_DESC[t.id]?.[1]) bad.push(`${t.id} has no description`);
    if (en?.text && !en.text.includes('{name}') && !en.text.includes('{Band}')) bad.push(`${t.id}: the English text names nobody`);
  }
  // every age opens with a discovery that exists and belongs to that age
  for (const [era, gate] of ERA_GATES) {
    const g = TECH_BY_ID.get(gate);
    if (!g) bad.push(`the gate of age ${era} ("${gate}") does not exist`);
    else if (eraOf(new Set([gate, ...collect(gate)])) !== era) bad.push(`knowing ${gate} does not open age ${era}`);
  }
  if (bad.length) throw new Error(bad.slice(0, 20).join('\n'));
}

function collect(id: string, seen = new Set<string>()): Set<string> {
  for (const r of TECH_BY_ID.get(id)?.prereq ?? []) if (!seen.has(r)) { seen.add(r); collect(r, seen); }
  return seen;
}

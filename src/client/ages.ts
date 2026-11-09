// The fork's ages: what opens each age, what the living clans know, and the progress bar under the clock.
import type { BandView } from '../shared/types';
import { ERAS_BG, ERAS_EN, TECH_EN, TECH_LIST } from '../shared/i18n';
import { ERA_GATES } from '../shared/later_techs';
import { EN, T } from './lang';
import { $ } from './kit';

/** the discovery that opens each age */
export const GATES = new Map<number, string>([[1, 'agriculture'], [2, 'bronze'], ...ERA_GATES]);
const TECH_ID_BY_BG = new Map(TECH_LIST.map(([id, bg]) => [bg, id]));
/** every discovery some living clan knows, by id (bands carry Bulgarian names) */
export function knownNow(bands: BandView[]): Set<string> {
  const s = new Set<string>();
  for (const b of bands) for (const t of b.techs) { const id = TECH_ID_BY_BG.get(t); if (id) s.add(id); }
  return s;
}
export const eraName = (e: number) => (EN ? ERAS_EN[e] : ERAS_BG[e]);
export const techLabel = (id: string) => (EN ? TECH_EN[id]?.name : TECH_LIST.find(([x]) => x === id)?.[1]) ?? id;

/** the bar under the clock: how much of this age is known, and what opens the next */
export function updateAgeProgress(bands: BandView[], currentEra: number) {
  const known = knownNow(bands);
  const list = TECH_LIST.filter(([, , e]) => e === currentEra);
  const n = list.filter(([id]) => known.has(id)).length;
  $('#ageCount').textContent = `${n}/${list.length}`;
  ($('#ageBar') as HTMLElement).style.width = `${list.length ? (n / list.length) * 100 : 0}%`;
  const next = currentEra + 1;
  const gate = GATES.get(next);
  const nextEl = $('#ageNext');
  if (next < ERAS_EN.length && gate) {
    nextEl.textContent = `${T('Следва', 'Next')}: ${eraName(next)}`;
    $('#ageProg').title = T(`${eraName(next)} започва, когато някой открие „${techLabel(gate)}“.`, `The ${eraName(next)} begins when someone discovers ${techLabel(gate)}.`);
  } else {
    nextEl.textContent = T('Последната епоха', 'The last age');
    $('#ageProg').title = '';
  }
}

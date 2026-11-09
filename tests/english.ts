// Nothing the page shows may come out in Bulgarian: every kind of deed, cause of death, discovery, and the English
// chronicle text of 600 simulated years (the moves, the brains, the events and the clans' own news included).
import { CAUSE_EN, TECH_EN, deedEn } from '../src/shared/i18n';
import { WONDERS, expeditionWhere } from '../src/shared/event_words';
import { Simulation } from '../src/server/sim/sim';

export function english() {
  const cyr = /[А-Яа-яЁё]/;
  const bad: string[] = [];
  const check = (what: string, text: string | undefined) => { if (text && cyr.test(text)) bad.push(`${what}: ${text}`); };
  // every deed the server can write (sim.ts and events.ts)
  const deeds = ['Устрои голям празник', 'Посрещна съседите на голям пир', 'Сънува сън, пълен с идеи', 'Поведе лова на мамут',
    'Доживя до 70 години (9 120 г. пр.н.е.)', 'Преоткри „Огън“ за своя род', 'Откри „Желязо“ (1 150 г. пр.н.е.)',
    ...Object.values(WONDERS).flat().map(([bg]) => `Построи ${bg}`), ...[3, 5, 7, 8].map((e) => `Поведе експедиция ${expeditionWhere(e)[0]}`)];
  for (const d of deeds) check('deed', deedEn(d));
  for (const [bg, en] of Object.entries(CAUSE_EN)) check(`cause ${bg}`, en);
  for (const [id, t] of Object.entries(TECH_EN)) { check(`tech ${id}`, t.name); check(`tech ${id}`, t.text); check(`tech ${id}`, t.kids); }
  const sim = new Simulation(null, 11);
  for (let i = 0; i < 12 * 600; i++) {
    sim.step();
    for (const e of sim.events) {
      if (!e.en) bad.push(`chronicle "${e.kind}" has no English: ${e.text}`);
      check(`chronicle ${e.kind}`, e.en?.text);
      check(`chronicle kids ${e.kind}`, e.en?.kids);
    }
    sim.events = []; sim.deadQueue = []; sim.goneQueue = [];
  }
  for (const p of sim.s.people) for (const d of p.deeds) check('deed in world', deedEn(d));
  if (bad.length) throw new Error(`Bulgarian would show in ${bad.length} place(s):\n` + [...new Set(bad)].slice(0, 20).join('\n'));
}

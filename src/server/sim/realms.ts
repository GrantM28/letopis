// Realms (fork, 1.59): villages long allied and joined by road become one realm, with a capital (its biggest village),
// a ruler (the capital's elder) and houses of rulers that pass the title from parent to child.
//
// Once a year (after the roads and trade routes):
//   - alliances are dated: a realm needs friends of 30 years
//   - villages join a realm whose village they are long allied with and joined to by road
//   - three or more such villages without a realm found one
//   - a village leaves when it turns rival to its capital or stops being a village; a realm whose capital is gone moves
//     its capital to its biggest village; a realm of fewer than two villages ends
//   - the capital's elder rules; when the elder changes the chronicle tells who follows, and a child of the last ruler
//     carries on the house
// What a realm does: in a hungry year its villages send food to the hungriest of them. No wars: rivals quarrel, as ever.

import type { Band, Person } from './sim';
import type { EventHost } from './events';
import { translit } from '../../shared/i18n';

export interface Ruler { id: number; name: string; sex: 0 | 1; since: number; house: string; n: number }
export interface Realm {
  id: number;
  name: string;
  capital: number;
  members: number[];
  since: number;
  hue: number;
  ruler: Ruler | null;
  /** the rulers before, newest last (the last 20) */
  past?: Ruler[];
  /** how many rulers each house has given (for "the third of the House of ...") */
  houses?: Record<string, number>;
}

export interface RealmHost extends EventHost {
  s: EventHost['s'] & { realms?: Record<number, Realm>; realmSeq?: number; allySince?: Record<string, number>;
    relState?: Record<string, 'ally' | 'rival'>; roadPairs?: string[] };
}

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const LONG = 30;
const REACH = 30;
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const ordinal = (k: number) => ORD[k] ?? `${k}th`;

/** what a realm and its ruler are called in each age */
export function titles(era: number, villages: number): { realm: string; m: string; f: string } {
  if (era <= 1) return { realm: 'Chiefdom', m: 'chief', f: 'chief' };
  if (era >= 3 && villages >= 8) return { realm: 'Empire', m: 'emperor', f: 'empress' };
  return { realm: 'Kingdom', m: 'king', f: 'queen' };
}

function hueOfRealm(id: number): number { return (id * 137.508 + 20) % 360; }

export function realmsStep(h: RealmHost, members: Map<number, Person[]>) {
  const year = Math.floor(h.year);
  // experiments only: LETOPIS_NO_REALMS=1 leaves realms out (to measure what they change)
  if (h.s.era < 1 || (typeof process !== 'undefined' && process.env?.LETOPIS_NO_REALMS === '1')) return; // villages and realms come with the New Stone Age
  const first = h.s.realms === undefined;
  const realms = (h.s.realms ??= {});
  const since = (h.s.allySince ??= {});
  const towns = new Map(h.s.bands.filter((b) => b.settled).map((b) => [b.id, b]));
  const size = (b: Band) => members.get(b.id)?.length ?? 0;
  // date the alliances (a world from before 1.59 counts its alliances as old enough at once)
  for (const [k, v] of Object.entries(h.s.relState ?? {})) {
    if (v === 'ally') since[k] ??= first ? year - LONG : year;
  }
  for (const k of Object.keys(since)) if (h.s.relState?.[k] !== 'ally') delete since[k];
  const roads = new Set((h.s.roadPairs ?? []).filter((e) => /:[12]$/.test(e)).map((e) => e.split(':')[0]));
  const bound = (a: number, b: number) => { const k = key(a, b); return since[k] !== undefined && year - since[k] >= LONG && roads.has(k); };
  const inRealm = new Map<number, Realm>();
  for (const r of Object.values(realms)) for (const m of r.members) inRealm.set(m, r);
  const label = (b: Band, subject = false) => h.bandEnLabel(b, subject);
  const say = (importance: number, kind: string, bandId: number | undefined, en: string, bg: string) => {
    if (!first) h.emit(kind, importance, bg, undefined, undefined, bandId, [], [en]);
  };

  // 1. villages leave, capitals move, realms end
  for (const r of Object.values(realms).sort((a, b) => a.id - b.id)) {
    let cap = towns.get(r.capital);
    if (!cap) {
      // the capital is gone or is no village any more: the biggest village left takes its place
      const left = r.members.map((m) => towns.get(m)).filter(Boolean) as Band[];
      const next = left.sort((a, b) => size(b) - size(a) || a.id - b.id)[0];
      if (next) {
        r.capital = next.id;
        cap = next;
        say(1, 'realm', next.id, `The ${r.name} moved its capital to ${label(next)}.`, `${r.name}: нова столица е ${h.bandLabel(next)}.`);
      }
    }
    r.members = r.members.filter((m) => {
      const b = towns.get(m);
      if (!b) return false;
      if (!cap || m === cap.id) return true;
      if (h.s.relState?.[key(m, cap.id)] === 'rival') {
        say(1, 'realm', m, `${label(b, true)} turned against ${label(cap)} and left the ${r.name}.`, `${h.bandLabel(b, true)} напусна ${r.name}.`);
        return false;
      }
      return true;
    });
    if (!cap || r.members.length < 2) {
      say(2, 'realm', cap?.id, `The ${r.name} is no more: ${r.members.length ? 'its last villages went their own ways' : 'its villages are gone'}.`, `${r.name} вече я няма.`);
      delete realms[r.id];
      for (const m of r.members) inRealm.delete(m);
      continue;
    }
    for (const m of r.members) inRealm.set(m, r);
  }
  for (const [m, r] of [...inRealm]) if (!realms[r.id] || !r.members.includes(m)) inRealm.delete(m);

  // 2. villages join a realm they are bound to (the biggest such realm near enough)
  for (const b of [...towns.values()].sort((a, c) => a.id - c.id)) {
    if (inRealm.has(b.id)) continue;
    let best: Realm | null = null;
    for (const r of Object.values(realms)) {
      const cap = towns.get(r.capital)!;
      if (Math.hypot(cap.cx - b.cx, cap.cy - b.cy) > REACH) continue;
      // never a rival of its capital (a village that just left over a feud would walk straight back in otherwise)
      if (h.s.relState?.[key(cap.id, b.id)] === 'rival') continue;
      if (!r.members.some((m) => bound(m, b.id))) continue;
      if (!best || r.members.length > best.members.length) best = r;
    }
    if (best) {
      best.members.push(b.id);
      inRealm.set(b.id, best);
      say(1, 'realm', b.id, `${label(b, true)} joined the ${best.name}.`, `${h.bandLabel(b, true)} се присъедини към ${best.name}.`);
    }
  }

  // 3. new realms: groups of three or more free villages bound to each other
  let rose = 0;
  for (let pass = 0; pass < (first ? 20 : 1); pass++) {
  const before = rose;
  const free = [...towns.values()].filter((b) => !inRealm.has(b.id)).sort((a, c) => a.id - c.id);
  const seen = new Set<number>();
  for (const start of free) {
    if (seen.has(start.id)) continue;
    const group: Band[] = [];
    const queue = [start];
    seen.add(start.id);
    while (queue.length) {
      const b = queue.shift()!;
      group.push(b);
      for (const o of free) if (!seen.has(o.id) && bound(b.id, o.id)) { seen.add(o.id); queue.push(o); }
    }
    if (group.length < 3) continue;
    const cap = group.slice().sort((a, c) => size(c) - size(a) || a.id - c.id)[0];
    // a realm reaches as far as its capital can hold: villages farther away stay free for now
    const held = group.filter((b) => Math.hypot(b.cx - cap.cx, b.cy - cap.cy) <= REACH);
    if (held.length < 3) continue;
    const id = (h.s.realmSeq = (h.s.realmSeq ?? 0) + 1);
    const t = titles(h.s.era, held.length);
    const r: Realm = { id, name: `${t.realm} of ${cap.settlementName ? translit(cap.settlementName) : label(cap).replace(/^the /, '')}`, capital: cap.id, members: held.map((b) => b.id), since: year, hue: hueOfRealm(id), ruler: null };
    realms[id] = r;
    for (const b of held) inRealm.set(b.id, r);
    rose++;
    const others = held.filter((b) => b !== cap).slice(0, 3).map((b) => label(b));
    say(2, 'realm', cap.id, `${label(cap, true)} and ${held.length - 1} villages around it (${others.join(', ')}${held.length > 4 ? ' and more' : ''}) joined into one realm: the ${r.name}, with ${label(cap)} as its capital.`,
      `${h.bandLabel(cap, true)} и ${held.length - 1} села около нея се обединиха: ${r.name}.`);
  }
  if (rose === before) break;
  }
  if (first && rose) {
    h.emit('realm', 2, `Селата започнаха да се обединяват: възникнаха ${rose} държави.`, undefined, undefined, undefined, [],
      [`The villages have begun to join into realms: ${rose} realm${rose === 1 ? '' : 's'} rose, each around its capital.`]);
  }

  // 4. rulers reign for life. When one dies or leaves the realm, the oldest grown child living in the realm follows and
  //    carries on the house; with no such child the capital's elder takes the title and a new house begins.
  const people = new Map(h.s.people.map((p) => [p.id, p]));
  const childrenOf = new Map<number, Person[]>();
  for (const p of h.s.people) for (const parent of [p.motherId, p.fatherId]) if (parent) (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(p);
  for (const r of Object.values(realms)) {
    const cap = towns.get(r.capital)!;
    // titles grow with the ages and the realm's size
    const t = titles(h.s.era, r.members.length);
    const kind = r.name.split(' of ')[0];
    if (kind !== t.realm) r.name = `${t.realm} of ${r.name.slice(kind.length + 4)}`;
    const inRealmNow = (p: Person) => r.members.includes(p.bandId);
    const current = r.ruler ? people.get(r.ruler.id) : undefined;
    if (current && inRealmNow(current)) continue;
    const before = r.ruler;
    const heir = before
      ? (childrenOf.get(before.id) ?? []).filter((c) => inRealmNow(c) && h.ageOf(c) >= 16).sort((x, y) => x.born - y.born)[0]
      : undefined;
    const next = heir ?? (cap.chiefId ? people.get(cap.chiefId) : undefined);
    if (!next) { if (before) { (r.past ??= []).push(before); r.ruler = null; } continue; }
    const house = heir ? before!.house : `House of ${h.nameEn(next).split(' ')[0]}`;
    r.houses ??= {};
    r.houses[house] = (r.houses[house] ?? 0) + 1;
    const ruler: Ruler = { id: next.id, name: h.nameEn(next), sex: next.sex, since: year, house, n: r.houses[house] };
    if (before) { (r.past ??= []).push(before); if (r.past.length > 20) r.past.shift(); }
    r.ruler = ruler;
    const title = next.sex ? t.f : t.m;
    if (before) {
      h.emit('ruler', 1, `${h.nameOf(next)} пое властта в ${r.name}.`, undefined, next.id, cap.id, [],
        [heir ? `${before.name} ${people.has(before.id) ? 'has left the realm' : 'is dead'}. ${ruler.name}, ${next.sex ? 'daughter' : 'son'} of ${before.name}, is now ${title} of the ${r.name}: the ${ordinal(ruler.n)} of the ${house}.`
          : `${before.name} left no heir in the ${r.name}. ${ruler.name}, elder of ${label(cap)}, is now ${title}, the first of the ${house}.`]);
    }
  }

  // 5. what a realm does: in a hungry year its villages send food to the hungriest of them
  for (const r of Object.values(realms)) {
    const vs = r.members.map((m) => towns.get(m)).filter(Boolean) as Band[];
    const hungry = vs.filter((b) => (b.fed ?? 1) < 0.85).sort((a, c) => (a.fed ?? 1) - (c.fed ?? 1));
    if (!hungry.length) continue;
    const rich = vs.filter((b) => (b.fed ?? 1) > 1.1).sort((a, c) => c.food - a.food);
    for (const poor of hungry.slice(0, 2)) {
      const giver = rich.find((b) => b.food > size(b) * 3);
      if (!giver) break;
      const give = Math.min(giver.food * 0.1, size(poor) * 2);
      giver.food -= give;
      poor.food += give;
    }
  }
}

/** for the map: every realm with its villages and capital */
export function realmMap(h: { s: { realms?: Record<number, Realm> } }) {
  return Object.values(h.s.realms ?? {}).map((r) => ({ id: r.id, name: r.name, hue: r.hue, capital: r.capital, members: r.members, ruler: r.ruler?.name ?? null }));
}

/** a realm's card */
export function realmCard(h: RealmHost, id: number, sizes: Map<number, number>) {
  const r = h.s.realms?.[id];
  if (!r) return null;
  const bands = new Map(h.s.bands.map((b) => [b.id, b]));
  const t = titles(h.s.era, r.members.length);
  const cap = bands.get(r.capital);
  return {
    id: r.id, name: r.name, hue: r.hue, since: r.since, kind: t.realm,
    capital: cap ? { id: cap.id, name: h.bandEnLabel(cap, true) } : null,
    ruler: r.ruler ? { ...r.ruler, title: r.ruler.sex ? t.f : t.m } : null,
    past: (r.past ?? []).slice().reverse(),
    villages: r.members.map((m) => bands.get(m)).filter(Boolean).map((b) => ({ id: b!.id, name: h.bandEnLabel(b!, true), size: sizes.get(b!.id) ?? 0 }))
      .sort((a, b) => b.size - a.size),
    people: r.members.reduce((a, m) => a + (sizes.get(m) ?? 0), 0),
  };
}

/** which realm a village belongs to, if any */
export function realmOf(h: { s: { realms?: Record<number, Realm> } }, bandId: number): Realm | null {
  for (const r of Object.values(h.s.realms ?? {})) if (r.members.includes(bandId)) return r;
  return null;
}

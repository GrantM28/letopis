// World events beyond the hunt, the winter and the drought: floods, plagues, harvests, comets, festivals,
// great buildings and expeditions, chosen by the age the world is in and what each band knows.
// Also the small things a watcher may do for the world (a blessing, rain, a feast).
// Kept out of sim.ts so the upstream file needs only a one-line hook.

import type { Band, Person } from './sim';
import type { Rng } from '../../shared/rng';
import type { Terrain } from './world';
import { idx, inBounds } from './world';
import type { ChronicleRef } from '../../shared/types';
import { WONDERS, expeditionWhere } from '../../shared/event_words';

/** the parts of the simulation the events need (private there, so reached through a cast) */
export interface EventHost {
  rng: Rng;
  s: { bands: Band[]; people: Person[]; era: number; tick: number; totalBorn: number };
  t: Terrain;
  month: number;
  year: number;
  emit(kind: string, importance: number, text: string, kids?: string, personId?: number, bandId?: number, extra?: ChronicleRef[], en?: [string, string?]): void;
  bandLabel(b: Band, subject?: boolean): string;
  bandEnLabel(b: Band, subject?: boolean): string;
  nameOf(p: Person): string;
  nameEn(p: Person): string;
  die(p: Person, cause: string, bandMembers?: Person[]): void;
  hasTech(b: Band, id: string): boolean;
  ageOf(p: Person): number;
}

const near = (h: EventHost, b: Band, R: number, f: (i: number) => boolean) => {
  const cx = Math.round(b.cx), cy = Math.round(b.cy);
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) if (inBounds(x, y) && f(idx(x, y))) return true;
  return false;
};
const adults = (h: EventHost, m: Person[]) => m.filter((p) => h.ageOf(p) >= 16);
const best = (ps: Person[], k: keyof Person['genes']) => ps.reduce((a, p) => (p.genes[k] > a.genes[k] ? p : a), ps[0]);


export function worldEvents(h: EventHost, members: Map<number, Person[]>) {
  const bands = h.s.bands;
  if (!bands.length) return;
  const era = h.s.era;
  const rng = h.rng;
  const pickBand = (f: (b: Band) => boolean) => {
    const c = bands.filter(f);
    return c.length ? rng.pick(c) : null;
  };

  // a spring flood along a river
  if ((h.month === 3 || h.month === 4) && rng.chance(0.025)) {
    const b = pickBand((x) => near(h, x, 3, (i) => h.t.river[i] > 40));
    if (b) {
      b.food *= 0.6;
      const m = members.get(b.id) ?? [];
      const lost = m.length > 8 && rng.chance(0.3) ? rng.pick(m) : null;
      if (lost) h.die(lost, 'загина в наводнението', m);
      h.emit('flood', 1, `Реката преля и заля стана на ${h.bandLabel(b)}. Водата отнесе част от запасите.`,
        `Реката стана голяма-голяма и намокри всичко при ${h.bandLabel(b)}!`, undefined, b.id, [],
        [`The river burst its banks and flooded the camp of ${h.bandEnLabel(b)}. The water carried off some of the stores.`,
          `The river grew big and wet everything at ${h.bandEnLabel(b)}!`]);
    }
  }

  // a plague in a crowded village: medicine and vaccines make it rarer and milder
  if (rng.chance(0.004)) {
    const b = pickBand((x) => x.settled && (members.get(x.id)?.length ?? 0) >= 30);
    if (b) {
      const cure = h.hasTech(b, 'antibiotics') ? 0.15 : h.hasTech(b, 'vaccination') ? 0.3 : h.hasTech(b, 'medicine') ? 0.6 : h.hasTech(b, 'herb_lore') ? 0.85 : 1;
      if (rng.chance(cure)) {
        const m = members.get(b.id)!;
        const toll = Math.max(1, Math.round(m.length * rng.range(0.04, 0.12) * cure));
        const victims = [...m].sort((a, c) => a.genes.hea - c.genes.hea).slice(0, toll);
        for (const p of victims) h.die(p, 'почина от мор', m);
        h.emit('plague', 2, `Мор плъзна из ${h.bandLabel(b)}. ${toll} души не преживяха болестта.`,
          `В ${h.bandLabel(b)} много хора се разболяха. Лечителите се грижат за тях.`, undefined, b.id, [],
          [`A plague swept through ${h.bandEnLabel(b)}. ${toll} people did not survive it.`,
            `Many people fell ill in ${h.bandEnLabel(b)}. The healers are looking after them.`]);
      } else if (cure < 1) {
        h.emit('plague', 1, `Болест се появи в ${h.bandLabel(b)}, но лечителите я спряха навреме.`, undefined, undefined, b.id, [],
          [`An illness appeared in ${h.bandEnLabel(b)}, but the healers stopped it in time.`]);
      }
    }
  }

  // a rich harvest for a farming village
  if (h.month === 8 && rng.chance(0.05)) {
    const b = pickBand((x) => x.settled && h.hasTech(x, 'agriculture'));
    if (b) {
      b.food += 30 + (members.get(b.id)?.length ?? 0) * 0.8;
      h.emit('harvest', 1, `Богата реколта в ${h.bandLabel(b)}. Хамбарите са пълни догоре.`,
        `В ${h.bandLabel(b)} узря толкова жито, че не се побира в хамбарите!`, undefined, b.id, [],
        [`A rich harvest at ${h.bandEnLabel(b)}. The granaries are full to the brim.`,
          `So much grain grew at ${h.bandEnLabel(b)} that it does not fit in the granaries!`]);
    }
  }

  // signs in the sky, seen by everyone
  if (rng.chance(0.0012)) {
    const later = era >= 5;
    h.emit('comet', 2, later ? 'Комета с дълга опашка прекоси небето. Учените я наблюдават с телескопи и пресмятат кога ще се върне.'
      : 'Комета с огнена опашка прекоси небето. Старите казват, че идват големи промени.',
    'На небето се появи звезда с дълга светла опашка! Всички излязоха да я гледат.', undefined, undefined, [],
    [later ? 'A comet with a long tail crossed the sky. Scholars watch it through telescopes and work out when it will return.'
      : 'A comet with a fiery tail crossed the sky. The old ones say that great changes are coming.',
    'A star with a long bright tail appeared in the sky! Everyone came out to watch it.']);
  }
  if (rng.chance(0.0015)) {
    h.emit('eclipse', 1, era >= 3 ? 'Слънчево затъмнение: денят стана нощ за няколко мига. Звездобройците го бяха предсказали.'
      : 'Луната изяде слънцето посред бял ден. Хората удряха барабани, докато светлината се върне.',
    'Слънцето се скри посред деня, а после пак изгря. Чудо!', undefined, undefined, [],
    [era >= 3 ? 'A solar eclipse: day became night for a few moments. The stargazers had foretold it.'
      : 'The Moon ate the Sun in broad daylight. People beat drums until the light came back.',
    'The Sun hid in the middle of the day and then came back. A wonder!']);
  }

  // an earthquake
  if (rng.chance(0.0012)) {
    const b = rng.pick(bands);
    const m = members.get(b.id) ?? [];
    b.food *= 0.8;
    const lost = b.settled && m.length > 10 && rng.chance(0.5) ? rng.pick(m) : null;
    if (lost) h.die(lost, 'загина при земетресението', m);
    h.emit('quake', 2, `Земята се разтресе под ${h.bandLabel(b)}.${b.settled ? ' Стени се срутиха, но хората ги вдигат наново.' : ''}`,
      `Земята се люшна при ${h.bandLabel(b)}! Всички се уплашиха, но се държат един за друг.`, undefined, b.id, [],
      [`The earth shook beneath ${h.bandEnLabel(b)}.${b.settled ? ' Walls fell down, but people are raising them again.' : ''}`,
        `The ground wobbled at ${h.bandEnLabel(b)}! Everyone was scared, but they held on to each other.`]);
  }

  // a fire in a town (towns of wood and thatch burn)
  if (era >= 2 && rng.chance(0.004)) {
    const b = pickBand((x) => x.settled && h.hasTech(x, 'mudbrick'));
    if (b) {
      b.food *= 0.8;
      h.emit('fire', 1, `Пожар избухна в ${h.bandLabel(b)}. Съседите гасиха с вериги от ведра до сутринта.`,
        `В ${h.bandLabel(b)} пламна огън, но всички помагаха с кофи вода!`, undefined, b.id, [],
        [`A fire broke out in ${h.bandEnLabel(b)}. Neighbours passed buckets hand to hand until morning.`,
          `A fire started in ${h.bandEnLabel(b)}, but everybody helped with buckets of water!`]);
    }
  }

  // an autumn festival in a village
  if (h.month === 9 && rng.chance(0.06)) {
    const b = pickBand((x) => x.settled);
    const m = b ? adults(h, members.get(b.id) ?? []) : [];
    if (b && m.length) {
      const host = best(m, 'soc');
      host.deeds.push('Устрои голям празник');
      h.emit('festival', 1, `${h.nameOf(host)} устрои празник на реколтата в ${h.bandLabel(b)}. Пя се и се игра до зори.`,
        `${h.nameOf(host)} направи голям празник в ${h.bandLabel(b)}. Имаше песни, хора и много вкусотии!`, host.id, b.id, [],
        [`${h.nameEn(host)} held a harvest festival in ${h.bandEnLabel(b)}. There was singing and dancing until dawn.`,
          `${h.nameEn(host)} threw a big party in ${h.bandEnLabel(b)}. There were songs, dances and lots of treats!`]);
    }
  }

  // a great building of its age, raised in a large town
  if (era >= 2 && rng.chance(0.006)) {
    const b = pickBand((x) => x.settled && (members.get(x.id)?.length ?? 0) >= 60);
    const m = b ? adults(h, members.get(b.id) ?? []) : [];
    const list = WONDERS[Math.min(era, 8)];
    if (b && m.length && list) {
      const [bg, en] = rng.pick(list);
      const builder = best(m, 'int');
      builder.deeds.push(`Построи ${bg}`);
      h.emit('wonder', 2, `${h.bandLabel(b, true)} издигна ${bg}. ${h.nameOf(builder)} водеше строежа.`,
        `${h.nameOf(builder)} построи ${bg}. Цялото село се гордее!`, builder.id, b.id, [],
        [`${h.bandEnLabel(b, true)} raised ${en}. ${h.nameEn(builder)} led the work.`,
          `${h.nameEn(builder)} built ${en}. The whole town is proud!`]);
    }
  }

  // an expedition into the unknown
  if (era >= 3 && rng.chance(0.003)) {
    const b = pickBand((x) => x.settled);
    const m = b ? adults(h, members.get(b.id) ?? []) : [];
    if (b && m.length) {
      const lead = best(m, 'cur');
      const where = expeditionWhere(era);
      lead.deeds.push(`Поведе експедиция ${where[0]}`);
      h.emit('expedition', 1, `${h.nameOf(lead)} от ${h.bandLabel(b)} поведе експедиция ${where[0]} и се върна с разкази и карти.`,
        `${h.nameOf(lead)} тръгна на голямо пътешествие ${where[0]}!`, lead.id, b.id, [],
        [`${h.nameEn(lead)} of ${h.bandEnLabel(b)} led an expedition ${where[1]} and came back with stories and maps.`,
          `${h.nameEn(lead)} set off on a great journey ${where[1]}!`]);
    }
  }
}

/// ---------- what a watcher may do ----------

export type ActKind = 'bless' | 'rain' | 'feast' | 'inspire' | 'calm';
export const ACTS: ActKind[] = ['bless', 'rain', 'feast', 'inspire', 'calm'];
/** real minutes between two acts of the same kind, for everyone watching this world */
export const ACT_COOLDOWN_MIN: Record<ActKind, number> = { bless: 20, rain: 30, feast: 45, inspire: 60, calm: 30 };

/** what the watchers' help needs from the simulation besides EventHost */
interface ActHost extends EventHost {
  s: EventHost['s'] & {
    inspired?: Record<number, number>; prayers?: Prayer[];
    relations?: Record<string, number>; relState?: Record<string, 'ally' | 'rival'>;
  };
  bRefs(b: Band): import('../../shared/types').ChronicleRef[];
}

/** the clans a band has sworn rivalry with */
function rivalsOf(h: ActHost, b: Band): Band[] {
  const out: Band[] = [];
  for (const [k, v] of Object.entries(h.s.relState ?? {})) {
    if (v !== 'rival') continue;
    const [x, y] = k.split('-').map(Number);
    const other = x === b.id ? y : y === b.id ? x : 0;
    const o = other ? h.s.bands.find((c) => c.id === other) : undefined;
    if (o) out.push(o);
  }
  return out;
}

/** a small, kind act; on the chosen band, or on the one that needs it most. Returns the band it touched */
export function act(hh: EventHost, kind: ActKind, members: Map<number, Person[]>, targetId?: number): Band | null {
  const h = hh as ActHost;
  const bands = h.s.bands;
  if (!bands.length) return null;
  const target = targetId ? bands.find((x) => x.id === targetId) ?? null : null;
  if (targetId && !target) return null;
  if (kind === 'bless') {
    const b = target ?? [...bands].sort((a, c) => (a.fed ?? 1) - (c.fed ?? 1))[0];
    const n = members.get(b.id)?.length ?? 10;
    b.food += 20 + n * 1.5;
    b.fed = Math.max(b.fed ?? 1, 1.3);
    h.emit('blessing', 2, `Неочаквана благодат за ${h.bandLabel(b)}: ловците се натъкнаха на пълно с дивеч поле, а храсталаците натежаха от плодове.`,
      `Някой се погрижи за ${h.bandLabel(b)}: изведнъж имаше храна за всички!`, undefined, b.id, [],
      [`An unexpected blessing for ${h.bandEnLabel(b)}: the hunters came upon a field full of game and the bushes bent with fruit.`,
        `Someone looked after ${h.bandEnLabel(b)}: suddenly there was food for everyone!`]);
    return b;
  }
  if (kind === 'rain') {
    // the driest land around a band: plants spring back
    const b = target ?? [...bands].sort((a, c) => plantsAround(h, a) - plantsAround(h, c))[0];
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    for (let y = cy - 10; y <= cy + 10; y++) for (let x = cx - 10; x <= cx + 10; x++) {
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      h.t.plants[i] = Math.min(h.t.plantsCap[i], h.t.plants[i] * 1.6 + h.t.plantsCap[i] * 0.2);
    }
    h.emit('rain', 2, `Дълъг топъл дъжд се изля над земите на ${h.bandLabel(b)}. Тревата и плодовете се върнаха.`,
      `Заваля хубав дъжд при ${h.bandLabel(b)} и всичко позеленя!`, undefined, b.id, [],
      [`A long warm rain fell over the lands of ${h.bandEnLabel(b)}. The grass and the fruit came back.`,
        `A lovely rain fell at ${h.bandEnLabel(b)} and everything turned green!`]);
    return b;
  }
  if (kind === 'inspire') {
    // the most curious adult has a dream; for two years the clan is four times as likely to find something new
    const b = target ?? [...bands].sort((a, c) => (members.get(c.id)?.length ?? 0) - (members.get(a.id)?.length ?? 0))[0];
    const m = adults(h, members.get(b.id) ?? []);
    const dreamer = m.length ? best(m, 'cur') : null;
    (h.s.inspired ??= {})[b.id] = 24;
    if (dreamer) dreamer.deeds.push('Сънува сън, пълен с идеи');
    h.emit('inspired', 2, `${dreamer ? `${h.nameOf(dreamer)} от ` : ''}${h.bandLabel(b, !dreamer)} сънува странен сън и се събуди с глава, пълна с идеи.`,
      `${dreamer ? h.nameOf(dreamer) : h.bandLabel(b, true)} сънува вълшебен сън и измисля нови неща!`, dreamer?.id, b.id, [],
      [`${dreamer ? `${h.nameEn(dreamer)} of ` : ''}${h.bandEnLabel(b, !dreamer)} had a strange dream and woke up full of ideas.`,
        `${dreamer ? h.nameEn(dreamer) : h.bandEnLabel(b, true)} had a magical dream and is inventing new things!`]);
    return b;
  }
  if (kind === 'calm') {
    // an old feud is laid to rest: the chosen clan's rivalries, or the bitterest one in the world
    let b = target;
    let rivals = b ? rivalsOf(h, b) : [];
    if (!b) {
      for (const c of bands) { const r = rivalsOf(h, c); if (r.length > rivals.length) { b = c; rivals = r; } }
    }
    if (!b || !rivals.length) return null;
    for (const o of rivals) {
      const k = b.id < o.id ? `${b.id}-${o.id}` : `${o.id}-${b.id}`;
      if (h.s.relations) h.s.relations[k] = 0;
      if (h.s.relState) delete h.s.relState[k];
    }
    const o = rivals[0];
    h.emit('peace', 2, `${h.bandLabel(b, true)} и ${h.bandLabel(o)} седнаха край един огън и се помириха.${rivals.length > 1 ? ' Старите вражди утихнаха.' : ''}`,
      `${h.bandLabel(b, true)} и ${h.bandLabel(o)} се сдобриха и вече са приятели!`, undefined, b.id, h.bRefs(o),
      [`${h.bandEnLabel(b, true)} and ${h.bandEnLabel(o)} sat down by one fire and made peace.${rivals.length > 1 ? ' The old feuds have gone quiet.' : ''}`,
        `${h.bandEnLabel(b, true)} and ${h.bandEnLabel(o)} made up and are friends now!`]);
    return b;
  }
  // a feast: the chosen clan, or the biggest, invites its neighbours
  const b = target ?? [...bands].sort((a, c) => (members.get(c.id)?.length ?? 0) - (members.get(a.id)?.length ?? 0))[0];
  b.food += 15;
  const m = adults(h, members.get(b.id) ?? []);
  const host = m.length ? best(m, 'soc') : null;
  if (host) host.deeds.push('Посрещна съседите на голям пир');
  h.emit('feast', 2, `${host ? `${h.nameOf(host)} от ` : ''}${h.bandLabel(b, !host)} покани съседите на голям пир. Разказваха се истории, сключваха се приятелства.`,
    `${h.bandLabel(b, true)} направи голямо угощение и покани всички!`, host?.id, b.id, [],
    [`${host ? `${h.nameEn(host)} of ` : ''}${h.bandEnLabel(b, !host)} invited the neighbours to a great feast. Stories were told and friendships were made.`,
      `${h.bandEnLabel(b, true)} made a great feast and invited everyone!`]);
  return b;
}

// ---------- prayers: clans in trouble ask the watchers for help ----------

export interface Prayer {
  id: number;
  band: number;
  /** what would help: a blessing (food), rain, or peace (calm) */
  want: 'bless' | 'rain' | 'calm';
  /** real time it was said, ms */
  at: number;
  /** the year in the world */
  year: number;
}
/** an unanswered prayer fades after this much real time */
export const PRAYER_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PRAYERS = 5;

/** every month: inspiration wears off, some clans in trouble pray, old prayers fade */
export function prayersStep(hh: EventHost, members: Map<number, Person[]>) {
  const h = hh as ActHost;
  const insp = h.s.inspired;
  if (insp) for (const k of Object.keys(insp)) { const id = Number(k); if (--insp[id] <= 0) delete insp[id]; }
  const prayers = (h.s.prayers ??= []);
  const now = Date.now();
  // fading: the clan is gone, or nobody answered in time
  for (let i = prayers.length - 1; i >= 0; i--) {
    const p = prayers[i];
    const b = h.s.bands.find((x) => x.id === p.band);
    if (!b) { prayers.splice(i, 1); continue; }
    if (now - p.at > PRAYER_TTL_MS) {
      prayers.splice(i, 1);
      const what = { bless: ['храна', 'food'], rain: ['дъжд', 'rain'], calm: ['мир', 'peace'] }[p.want];
      h.emit('prayer', 1, `${h.bandLabel(b, true)} молеше за ${what[0]}, но небето мълча.`, undefined, undefined, b.id, [],
        [`${h.bandEnLabel(b, true)} prayed for ${what[1]}, but the sky stayed silent.`]);
    }
  }
  if (prayers.length >= MAX_PRAYERS || !h.rng.chance(0.08)) return;
  // who is in trouble, and what would help them
  const asking = h.s.bands.filter((b) => !prayers.some((p) => p.band === b.id) && (members.get(b.id)?.length ?? 0) >= 8);
  const needs: { b: Band; want: Prayer['want'] }[] = [];
  for (const b of asking) {
    if ((b.fed ?? 1) < 0.85) needs.push({ b, want: 'bless' });
    else if (plantsAround(h, b) < 0.35) needs.push({ b, want: 'rain' });
    else if (rivalsOf(h, b).length) needs.push({ b, want: 'calm' });
  }
  if (!needs.length) return;
  const { b, want } = h.rng.pick(needs);
  const id = (prayers.reduce((m, p) => Math.max(m, p.id), 0) || h.s.tick * 10) + 1;
  prayers.push({ id, band: b.id, want, at: now, year: Math.floor(h.year) });
  const text: Record<Prayer['want'], [string, string]> = {
    bless: [`Старите от ${h.bandLabel(b)} запалиха огън и молят за храна: децата са гладни.`, `The elders of ${h.bandEnLabel(b)} lit a fire and pray for food: the children are hungry.`],
    rain: [`${h.bandLabel(b, true)} танцува за дъжд: земята около тях е напукана.`, `${h.bandEnLabel(b, true)} are dancing for rain: the land around them is cracked and dry.`],
    calm: [`${h.bandLabel(b, true)} се моли враждата със съседите да свърши.`, `${h.bandEnLabel(b, true)} pray for the feud with their neighbours to end.`],
  };
  h.emit('prayer', 2, text[want][0], undefined, undefined, b.id, [], [text[want][1]]);
}

/** answering a prayer: the act it asked for, on the clan that asked */
export function answerPrayer(hh: EventHost, id: number, members: Map<number, Person[]>): { band: Band; want: Prayer['want'] } | null {
  const h = hh as ActHost;
  const prayers = h.s.prayers ?? [];
  const i = prayers.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const p = prayers[i];
  prayers.splice(i, 1);
  const b = act(h, p.want, members, p.band);
  return b ? { band: b, want: p.want } : null;
}

function plantsAround(h: EventHost, b: Band): number {
  const cx = Math.round(b.cx), cy = Math.round(b.cy);
  let s = 0, cap = 0;
  for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) {
    if (!inBounds(x, y)) continue;
    const i = idx(x, y);
    s += h.t.plants[i]; cap += h.t.plantsCap[i];
  }
  return cap ? s / cap : 1;
}

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

// ---------- what a watcher may do ----------

export type ActKind = 'bless' | 'rain' | 'feast';
export const ACTS: ActKind[] = ['bless', 'rain', 'feast'];
/** real minutes between two acts of the same kind, for everyone watching this world */
export const ACT_COOLDOWN_MIN: Record<ActKind, number> = { bless: 20, rain: 30, feast: 45 };

/** a small, kind act on the band that needs it most; returns the band it touched */
export function act(h: EventHost, kind: ActKind, members: Map<number, Person[]>): Band | null {
  const bands = h.s.bands;
  if (!bands.length) return null;
  const hungriest = [...bands].sort((a, b) => (a.fed ?? 1) - (b.fed ?? 1))[0];
  if (kind === 'bless') {
    const b = hungriest;
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
    const b = [...bands].sort((a, c) => plantsAround(h, a) - plantsAround(h, c))[0];
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
  // a feast: the biggest band invites its neighbours; people meet and pair more easily
  const b = [...bands].sort((a, c) => (members.get(c.id)?.length ?? 0) - (members.get(a.id)?.length ?? 0))[0];
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

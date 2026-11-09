// Friendship and rivalry between neighbouring clans.
// Every pair of neighbours has a feeling from -100 (rivals) to +100 (allies). It warms when they share a language of trade,
// marry into each other and help in hard times, and cools when they crowd the same hunting grounds while hungry.
// Allies send food to each other in a bad year and trade when both know how; rivals quarrel over land
// (nothing violent on screen: a stolen goat, a broken fence, a shouting match at the ford).

import type { Band, Person } from './sim';
import type { EventHost } from './events';
import type { ChronicleRef } from '../../shared/types';

export interface RelationHost extends EventHost {
  s: EventHost['s'] & { relations?: Record<string, number> };
  bRefs(b: Band): ChronicleRef[];
}

export const ALLY = 50;
export const RIVAL = -50;
/** how far apart (in tiles) two clans still count as neighbours */
const NEAR = 18;

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const dist = (a: Band, b: Band) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

export function relationOf(h: { s: { relations?: Record<string, number> } }, a: number, b: number): number {
  return h.s.relations?.[key(a, b)] ?? 0;
}

/** every few months: feelings drift, alliances and rivalries are made and broken, allies help each other */
export function relationsStep(h: RelationHost, members: Map<number, Person[]>) {
  const rel = (h.s.relations ??= {});
  const bands = h.s.bands;
  const rng = h.rng;
  const size = (b: Band) => members.get(b.id)?.length ?? 0;
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i], b = bands[j];
      const d = dist(a, b);
      if (d > NEAR) continue;
      const k = key(a.id, b.id);
      const before = rel[k] ?? 0;
      let delta = rng.range(-1.5, 1.5);
      // traders and neighbours who once shared a clan like each other
      if (h.hasTech(a, 'trade') && h.hasTech(b, 'trade')) delta += 1.2;
      if (a.from?.id === b.id || b.from?.id === a.id) delta += 0.45;
      if (h.hasTech(a, 'writing') && h.hasTech(b, 'writing')) delta += 0.4;
      // two hungry clans on the same ground do not
      const hungry = (a.fed ?? 1) < 0.9 && (b.fed ?? 1) < 0.9;
      if (d < 10 && hungry) delta -= 2;
      // wanderers crowding each other wear on the nerves
      if (d < 8 && !a.settled && !b.settled) delta -= 0.4;
      // feelings fade slowly towards nothing when nothing happens
      let now = Math.max(-100, Math.min(100, before + delta - before * 0.01));

      // allies carry food to a hungry friend
      if (now >= ALLY) {
        const [rich, poor] = a.food > b.food ? [a, b] : [b, a];
        if ((poor.fed ?? 1) < 0.9 && rich.food > size(rich) * 2) {
          const give = Math.min(rich.food * 0.15, size(poor) * 2);
          rich.food -= give; poor.food += give;
          now = Math.min(100, now + 4);
          if (rng.chance(0.15)) {
            h.emit('aid', 1, `${h.bandLabel(rich, true)} изпрати храна на гладуващите си приятели от ${h.bandLabel(poor)}.`, undefined, undefined, rich.id, h.bRefs(poor),
              [`${h.bandEnLabel(rich, true)} sent food to their hungry friends of ${h.bandEnLabel(poor)}.`]);
          }
        }
        // a trade road between two friendly towns makes both a little richer
        if (h.hasTech(a, 'trade') && h.hasTech(b, 'trade')) { a.food += 0.6; b.food += 0.6; }
      }
      // rivals quarrel now and then
      if (now <= RIVAL && rng.chance(0.03)) {
        const [loser, winner] = rng.chance(0.5) ? [a, b] : [b, a];
        loser.food *= 0.9;
        const why = rng.pick([
          ['се скараха за ловните полета', 'quarrelled over the hunting grounds'],
          ['се караха до залез на брода', 'argued until sunset at the ford'],
          ['спорят чия е горичката', 'are arguing about whose grove it is'],
          ['обвиниха съседите, че им отвели козите', 'accused the neighbours of leading their goats away'],
        ]);
        h.emit('quarrel', 1, `${h.bandLabel(loser, true)} и ${h.bandLabel(winner)} ${why[0]}.`, undefined, undefined, loser.id, h.bRefs(winner),
          [`${h.bandEnLabel(loser, true)} and ${h.bandEnLabel(winner)} ${why[1]}.`]);
      }

      // crossing a line is news
      if (before < ALLY && now >= ALLY) {
        h.emit('alliance', 2, `${h.bandLabel(a, true)} и ${h.bandLabel(b)} се заклеха в приятелство. Ще си помагат в лоши години.`,
          `${h.bandLabel(a, true)} и ${h.bandLabel(b)} станаха най-добри приятели!`, undefined, a.id, h.bRefs(b),
          [`${h.bandEnLabel(a, true)} and ${h.bandEnLabel(b)} swore friendship. They will help each other in bad years.`,
            `${h.bandEnLabel(a, true)} and ${h.bandEnLabel(b)} became best friends!`]);
      } else if (before > RIVAL && now <= RIVAL) {
        h.emit('rivalry', 1, `Между ${h.bandLabel(a)} и ${h.bandLabel(b)} легна лоша кръв. Вече не си говорят.`,
          `${h.bandLabel(a, true)} и ${h.bandLabel(b)} се сърдят един на друг.`, undefined, a.id, h.bRefs(b),
          [`Bad blood grew between ${h.bandEnLabel(a)} and ${h.bandEnLabel(b)}. They no longer speak to each other.`,
            `${h.bandEnLabel(a, true)} and ${h.bandEnLabel(b)} are cross with each other.`]);
      } else if (before <= RIVAL && now > RIVAL + 15) {
        h.emit('peace', 1, `${h.bandLabel(a, true)} и ${h.bandLabel(b)} забравиха старата си вражда.`, undefined, undefined, a.id, h.bRefs(b),
          [`${h.bandEnLabel(a, true)} and ${h.bandEnLabel(b)} put their old feud behind them.`]);
      }
      if (Math.abs(now) < 0.5) delete rel[k]; else rel[k] = Math.round(now * 10) / 10;
    }
  }
  // forget the clans that are gone
  if (h.s.tick % 60 === 0) {
    const alive = new Set(bands.map((b) => b.id));
    for (const k of Object.keys(rel)) {
      const [x, y] = k.split('-').map(Number);
      if (!alive.has(x) || !alive.has(y)) delete rel[k];
    }
  }
}

/** a clan's friends and rivals, for its card */
export function relationsOf(h: { s: { bands: Band[]; relations?: Record<string, number> } }, id: number): { id: number; score: number }[] {
  const out: { id: number; score: number }[] = [];
  for (const [k, v] of Object.entries(h.s.relations ?? {})) {
    const [x, y] = k.split('-').map(Number);
    if (x === id) out.push({ id: y, score: v });
    else if (y === id) out.push({ id: x, score: v });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** how many alliances and rivalries there are now */
export function relationCounts(h: { s: { relations?: Record<string, number> } }): { alliances: number; rivalries: number } {
  let alliances = 0, rivalries = 0;
  for (const v of Object.values(h.s.relations ?? {})) { if (v >= ALLY) alliances++; else if (v <= RIVAL) rivalries++; }
  return { alliances, rivalries };
}

// What must always hold in a living world, and what must not pile up in the save. Used by the full simulation test
// (tools/fulltest.ts, long runs of many worlds) and by `npm test` (a short run).
import type { Simulation } from '../src/server/sim/sim';
import type { ChronicleEntry } from '../src/shared/types';

export interface Problem { level: 'error' | 'leak'; what: string }

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** check a world after a month; `yearly` when the yearly steps (roads, trade, realms) have just run */
export function checkWorld(sim: Simulation, yearly: boolean): Problem[] {
  const out: Problem[] = [];
  const err = (what: string) => out.push({ level: 'error', what });
  const leak = (what: string) => out.push({ level: 'leak', what });
  const s = sim.s;
  const W = sim.t.w, H = sim.t.h;
  const bands = new Map(s.bands.map((b) => [b.id, b]));
  const people = new Map(s.people.map((p) => [p.id, p]));
  if (people.size !== s.people.length) err(`${s.people.length - people.size} people listed twice`);
  if (bands.size !== s.bands.length) err(`${s.bands.length - bands.size} clans listed twice`);
  const members = new Map<number, number>();
  for (const p of s.people) {
    members.set(p.bandId, (members.get(p.bandId) ?? 0) + 1);
    if (!bands.has(p.bandId)) { err(`person ${p.id} in clan ${p.bandId}, which does not exist`); break; }
    if (!finite(p.x) || !finite(p.y)) { err(`person ${p.id} has no place (${p.x}, ${p.y})`); break; }
    if (p.x < -2 || p.y < -2 || p.x > W + 2 || p.y > H + 2) { err(`person ${p.id} off the map at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`); break; }
    if (p.born > s.tick) { err(`person ${p.id} born in the future`); break; }
    if (Object.values(p.genes).some((g) => !finite(g))) { err(`person ${p.id} has a broken gene`); break; }
    if (p.partnerId !== null) {
      const q = people.get(p.partnerId);
      if (q && q.partnerId !== p.id) { err(`person ${p.id}'s partner ${q.id} has another partner (${q.partnerId})`); break; }
    }
    if (p.motherId === p.id || p.fatherId === p.id) { err(`person ${p.id} is their own parent`); break; }
  }
  for (const b of s.bands) {
    if (!finite(b.cx) || !finite(b.cy) || b.cx < 0 || b.cy < 0 || b.cx >= W || b.cy >= H) err(`clan ${b.id} camps off the map at ${b.cx}, ${b.cy}`);
    if (!finite(b.food) || b.food < 0) err(`clan ${b.id} has food ${b.food}`);
    if (b.fed !== undefined && !finite(b.fed)) err(`clan ${b.id} has fed ${b.fed}`);
    if (!members.get(b.id)) err(`clan ${b.id} has nobody in it`);
    if (new Set(b.techs).size !== b.techs.length) err(`clan ${b.id} knows a discovery twice`);
  }
  if (new Set(s.discovered).size !== s.discovered.length) err('a discovery is listed as first found twice');
  // the fork's add-ons
  const brains = s.brains ?? {};
  const staleBrains = Object.keys(brains).filter((id) => !bands.has(Number(id))).length;
  if (staleBrains > s.bands.length) leak(`${staleBrains} brains of gone clans kept`);
  for (const b of s.bands) {
    const br = brains[b.id];
    if (!br) continue;
    if (br.culture !== undefined && !s.cultures?.[br.culture]) { err(`clan ${b.id} follows culture ${br.culture}, which does not exist`); break; }
    if (br.out?.some((v) => !finite(v))) { err(`clan ${b.id}'s brain decided ${JSON.stringify(br.out)}`); break; }
    if (br.mem?.some((v) => !finite(v))) { err(`clan ${b.id}'s memory is broken`); break; }
  }
  for (const c of Object.values(s.cultures ?? {})) {
    if (c.net.some((v) => !finite(v))) err(`culture ${c.id} has a broken weight`);
    if (Math.max(...c.net.map(Math.abs)) > 6.0001) err(`culture ${c.id} has a weight past the limit`);
  }
  const followed = new Set(Object.values(brains).map((b) => b.culture));
  const unfollowed = Object.keys(s.cultures ?? {}).filter((id) => !followed.has(Number(id))).length;
  if (unfollowed > 5) leak(`${unfollowed} cultures nobody follows`);
  if (yearly) {
    for (const r of Object.values(s.realms ?? {})) {
      for (const m of r.members) if (!bands.get(m)?.settled) { err(`realm ${r.id} holds ${m}, which is no village`); break; }
      if (!r.members.includes(r.capital)) err(`realm ${r.id}'s capital ${r.capital} is not one of its villages`);
      if (r.members.length < 2) err(`realm ${r.id} has ${r.members.length} village(s)`);
    }
    const inRealm = new Map<number, number>();
    for (const r of Object.values(s.realms ?? {})) for (const m of r.members) { if (inRealm.has(m)) err(`village ${m} is in two realms`); inRealm.set(m, r.id); }
    for (const [k, t] of Object.entries(s.trade ?? {})) {
      if (!bands.get(t.a)?.settled || !bands.get(t.b)?.settled) { err(`trade route ${k} joins a village that is gone`); break; }
    }
  }
  // what must not grow without end in the save
  const gone = (keys: string[], parse: (k: string) => number[]) => keys.filter((k) => parse(k).some((id) => !bands.has(id))).length;
  const relGone = gone(Object.keys(s.relations ?? {}), (k) => k.split('-').map(Number));
  if (relGone > 4 * s.bands.length + 50) leak(`${relGone} relations of gone clans kept`);
  const moveGone = gone(Object.keys(s.moveNews ?? {}), (k) => [Number(k)]);
  if (moveGone > 2 * s.bands.length + 50) leak(`${moveGone} move notes of gone clans kept`);
  const allyGone = gone(Object.keys(s.allySince ?? {}), (k) => k.split('-').map(Number));
  if (allyGone > s.bands.length + 50) leak(`${allyGone} alliance dates of gone clans kept`);
  const inspiredGone = gone(Object.keys(s.inspired ?? {}), (k) => [Number(k)]);
  if (inspiredGone > 50) leak(`${inspiredGone} inspirations of gone clans kept`);
  return out;
}

/** what is wrong with a chronicle entry, if anything */
export function checkEvent(e: ChronicleEntry): string | null {
  const t = e.en?.text;
  if (!t) return `${e.kind}: no English text`;
  if (/[Ѐ-ӿ]/.test(t)) return `${e.kind}: Bulgarian in the English: ${t.slice(0, 120)}`;
  if (/undefined|NaN|\[object|null\b/.test(t)) return `${e.kind}: a broken value: ${t.slice(0, 120)}`;
  if (/ {2,}|\s[.,]/.test(t)) return `${e.kind}: broken spacing: ${t.slice(0, 120)}`;
  if (!finite(e.year)) return `${e.kind}: no year`;
  return null;
}

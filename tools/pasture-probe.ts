// Experiment: how much grass is around each clan's camp, and how many herders graze nearby (dev world snapshot).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { generateTerrain, idx, inBounds } from '../src/server/sim/world';
const st = JSON.parse(gunzipSync(readFileSync(process.argv[2] ?? 'data/world.json.gz')).toString('utf8'));
const t = generateTerrain(st.seed);
const herders = new Map<number, number>();
for (const p of st.people) if (p.task === 'herd') herders.set(p.bandId, (herders.get(p.bandId) ?? 0) + 1);
const rows: [number, number, number][] = [];
for (const b of st.bands) {
  let grass = 0;
  for (let y = Math.round(b.cy) - 6; y <= Math.round(b.cy) + 6; y++) for (let x = Math.round(b.cx) - 6; x <= Math.round(b.cx) + 6; x++) if (inBounds(x, y)) grass += t.plantsCap[idx(x, y)];
  let near = 0;
  for (const o of st.bands) if (Math.hypot(o.cx - b.cx, o.cy - b.cy) <= 8) near += herders.get(o.id) ?? 0;
  rows.push([grass, herders.get(b.id) ?? 0, near]);
}
const q = (a: number[], f: number) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * f)];
const g = rows.map((r) => r[0]), own = rows.map((r) => r[1]), near = rows.map((r) => r[2]);
console.log('clans', rows.length, 'people', st.people.length, 'herders', [...herders.values()].reduce((a, v) => a + v, 0));
console.log('grass around camp  p10/p50/p90', q(g, 0.1).toFixed(0), q(g, 0.5).toFixed(0), q(g, 0.9).toFixed(0));
console.log('own herders        p10/p50/p90', q(own, 0.1), q(own, 0.5), q(own, 0.9));
console.log('herders within 8   p10/p50/p90', q(near, 0.1), q(near, 0.5), q(near, 0.9));
console.log('near herders per grass p50', (q(rows.map((r) => r[2] / Math.max(1, r[0])), 0.5)).toFixed(3));

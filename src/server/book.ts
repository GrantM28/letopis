// The book of the world (fork, 1.58): the whole history as one readable page, a chapter for every age, made on the
// server as plain HTML (no script), so it prints, saves as a PDF from the browser, and can be shared as a link.
// The map on its first page is drawn here too, as a small PNG.

import { deflateSync } from 'node:zlib';
import { ERAS_EN } from '../shared/i18n';
import { BIOME_RGB } from '../shared/biomecolors';
import type { Simulation } from './sim/sim';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const yr = (y: number) => (y < 0 ? `${Math.round(-y).toLocaleString('en')} BC` : `AD ${Math.round(y)}`);
const n = (v: number) => Math.round(v).toLocaleString('en');

// ---------- a tiny PNG encoder (RGB, no filtering) ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.subarray(y * w * 3, (y + 1) * w * 3).forEach((v, i) => { raw[y * (w * 3 + 1) + 1 + i] = v; }); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** the explored land in its colours, every village a light square, every wandering clan a dot; twice the map's size */
export function mapPng(sim: Simulation): Buffer {
  const t = sim.t, W = t.w, H = t.h, S = 2;
  const rgb = new Uint8Array(W * S * H * S * 3);
  const put = (x: number, y: number, c: readonly number[]) => {
    if (x < 0 || y < 0 || x >= W * S || y >= H * S) return;
    const o = (y * W * S + x) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const c = !t.explored[i] ? [24, 28, 38] : t.river[i] > 40 ? BIOME_RGB[1] : BIOME_RGB[t.biome[i]] ?? [90, 90, 90];
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put(x * S + dx, y * S + dy, c);
  }
  for (const b of sim.s.bands) {
    const cx = Math.round(b.cx * S), cy = Math.round(b.cy * S), r = b.settled ? 2 : 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) put(cx + dx, cy + dy, b.settled ? [250, 236, 200] : [40, 30, 20]);
  }
  return png(W * S, H * S, rgb);
}

// ---------- the book ----------

interface TimelineRow { id: number; year: number; kind: string; importance: number; text: string }
interface Timeline { year: number; era: number; events: TimelineRow[]; cultures: { name: string; since: number; from: string | null; clans: number }[]; population: [number, number][] }
interface Facts {
  records: { largestBand?: { size: number; name: string; year: number }; oldest?: { age: number; name: string; year: number }; peak?: { population: number; year: number } };
  heroes: { name: string; age: number; band: string; deeds: string[] }[];
}

export function bookHtml(sim: Simulation, tl: Timeline, f: Facts): string {
  const eraStarts = tl.events.filter((e) => e.kind === 'era').map((e) => e.year);
  const starts = [-12000, ...eraStarts];
  const popAt = (y: number) => {
    let best: [number, number] | null = null;
    for (const p of tl.population) if (p[0] <= y) best = p; else break;
    return best?.[1] ?? null;
  };
  const people = sim.s.people.length, clans = sim.s.bands.length, villages = sim.s.bands.filter((b) => b.settled).length;
  const firsts = tl.events.filter((e) => e.kind === 'discovery').length;
  const chapters = starts.map((from, age) => {
    const to = starts[age + 1] ?? tl.year;
    const inAge = (y: number) => y >= from && (age + 1 < starts.length ? y < to : true);
    const ev = tl.events.filter((e) => inAge(e.year));
    const disc = ev.filter((e) => e.kind === 'discovery');
    const great = ev.filter((e) => !['discovery', 'era', 'genesis', 'settle', 'culture'].includes(e.kind));
    const settled = ev.filter((e) => e.kind === 'settle');
    const opening = ev.find((e) => e.kind === 'era' || e.kind === 'genesis');
    const cult = tl.cultures.filter((c) => inAge(c.since));
    const p0 = popAt(from) ?? (age === 0 ? 36 : null), p1 = popAt(to);
    return `<section class="chapter">
      <h2><span class="num">${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][age] ?? age + 1}</span> ${esc(ERAS_EN[age] ?? `Age ${age + 1}`)}</h2>
      <p class="span">${yr(from)} to ${age + 1 < starts.length ? yr(to) : `${yr(to)}, and still going`}${p0 !== null && p1 !== null ? ` · from ${n(p0)} to ${n(p1)} people` : ''}</p>
      ${opening ? `<p class="lead">${esc(opening.text)}</p>` : ''}
      ${disc.length ? `<h3>What was first found</h3><ol class="events">${disc.map((e) => `<li><span class="y">${yr(e.year)}</span>${esc(e.text)}</li>`).join('')}</ol>` : ''}
      ${great.length ? `<h3>What happened</h3><ol class="events">${great.map((e) => `<li><span class="y">${yr(e.year)}</span>${esc(e.text)}</li>`).join('')}</ol>` : ''}
      ${settled.length ? `<h3>Villages</h3><p>${settled.length === 1 ? 'One village was founded' : `${n(settled.length)} villages were founded`} in this age, the first in ${yr(settled[0].year)}.</p>` : ''}
      ${cult.length ? `<h3>Cultures</h3><p>${cult.length > 12 ? `${cult.length} of the cultures alive today began in this age, among them ` : 'Of the cultures alive today, these began in this age: '}${cult.slice(0, 12).map((c) => `the culture of ${esc(c.name.replace(/^the /, 'the '))}${c.from ? ` (from the culture of ${esc(c.from)})` : ''}`).join(', ')}.</p>` : ''}
    </section>`;
  }).join('');
  const r = f.records;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Book of the World · Letopis</title>
<style>
  :root { --ink: #2a2118; --muted: #7a6a58; --line: #e2d6c2; --accent: #8a4b16; --paper: #fbf6ec; }
  body { margin: 0; background: #efe6d4; color: var(--ink); font: 17px/1.6 Georgia, 'Times New Roman', serif; }
  main { max-width: 760px; margin: 0 auto; background: var(--paper); padding: 48px 56px 80px; box-shadow: 0 2px 30px rgba(60, 40, 10, 0.12); }
  h1 { font-size: 40px; text-align: center; margin: 10px 0 4px; letter-spacing: 0.5px; }
  .sub { text-align: center; color: var(--muted); margin: 0 0 24px; }
  .map { display: block; margin: 0 auto 8px; max-width: 100%; image-rendering: pixelated; border: 1px solid var(--line); }
  .caption { text-align: center; color: var(--muted); font-size: 14px; margin-bottom: 28px; }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 0 0 30px; }
  .facts div { border-top: 2px solid var(--line); padding-top: 6px; } .facts b { display: block; font-size: 22px; } .facts span { color: var(--muted); font-size: 13px; }
  h2 { font-size: 28px; margin: 46px 0 2px; border-bottom: 1px solid var(--line); padding-bottom: 6px; } h2 .num { color: var(--accent); margin-right: 8px; }
  .span { color: var(--muted); margin: 4px 0 14px; } .lead { font-style: italic; }
  h3 { font-size: 18px; color: var(--accent); margin: 22px 0 6px; }
  ol.events { list-style: none; padding: 0; margin: 0; } ol.events li { padding: 4px 0 4px 104px; position: relative; }
  ol.events .y { position: absolute; left: 0; width: 96px; color: var(--muted); font-size: 14px; }
  .bar { position: sticky; top: 0; text-align: right; padding: 8px 0; background: var(--paper); }
  .bar a, .bar button { font: 14px system-ui, sans-serif; color: var(--accent); background: none; border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; cursor: pointer; text-decoration: none; margin-left: 6px; }
  footer { margin-top: 50px; color: var(--muted); font-size: 14px; text-align: center; }
  @media (max-width: 640px) { main { padding: 24px 18px 60px; } h1 { font-size: 30px; } .facts { grid-template-columns: repeat(2, 1fr); } ol.events li { padding-left: 0; } ol.events .y { position: static; display: block; } }
  @media print { body { background: none; } main { box-shadow: none; padding: 0; max-width: none; } .bar { display: none; } h2 { break-after: avoid; } .chapter { break-inside: auto; } }
</style></head><body><main>
<div class="bar"><a href="/">Back to the world</a><button onclick="print()">Print or save as PDF</button></div>
<h1>The Book of the World</h1>
<p class="sub">World ${esc(sim.s.worldId)} · seed ${sim.s.seed} · written in ${yr(tl.year)}</p>
<img class="map" src="/api/book/map.png?t=${sim.s.tick}" alt="The map of the world as far as its people have seen it" width="${sim.t.w * 2}" height="${sim.t.h * 2}">
<p class="caption">The world as far as its people have seen it. Light squares are villages, dots are wandering clans.</p>
<div class="facts">
  <div><b>${n(people)}</b><span>people alive</span></div><div><b>${n(clans)}</b><span>clans, ${n(villages)} of them villages</span></div>
  <div><b>${n(firsts)}</b><span>first discoveries</span></div><div><b>${tl.cultures.length}</b><span>cultures alive</span></div>
  ${r.peak ? `<div><b>${n(r.peak.population)}</b><span>the most at once, ${yr(r.peak.year)}</span></div>` : ''}
  ${r.oldest ? `<div><b>${r.oldest.age}</b><span>years: ${esc(r.oldest.name)}, the oldest who ever lived</span></div>` : ''}
</div>
${chapters}
${f.heroes.length ? `<section class="chapter"><h2>The living</h2><p class="span">Some of the people alive as this book is written.</p>
  <ol class="events">${f.heroes.slice(0, 15).map((h) => `<li><span class="y">${h.age} years</span><b>${esc(h.name)}</b> of ${esc(h.band)}${h.deeds.length ? `: ${esc(h.deeds.slice(0, 2).join('; '))}` : ''}</li>`).join('')}</ol></section>` : ''}
<footer>Letopis · a world that lives on its own · this book is written anew each time it is opened</footer>
</main></body></html>`;
}

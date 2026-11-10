// The network drawn to be read (1.60): the senses in their groups, each neuron with only its three strongest links,
// 12 px labels, and pointing at a decision lights the paths that feed it, back to the senses.
import type { DeepNet } from './brainview';

const NET_GROUPS: [string, string[]][] = [
  ['Season', ['spring/autumn', 'winter/summer', 'warmth']], ['Food', ['hunger', 'food stores']], ['Land', ['fruit', 'game', 'fish', 'wood']],
  ['People', ['size', 'children', 'elders', 'settled']], ['Neighbours', ['crowding', 'friends near', 'rivals near']], ['Times', ['age of the world', 'last period']],
];
const NICE: Record<string, string> = { 'spring/autumn': 'spring ↔ autumn', 'winter/summer': 'winter ↔ summer', 'food stores': 'stores', 'friends near': 'friends', 'rivals near': 'rivals', 'last period': 'last five years' };
const DECIDE: Record<string, string> = { farm: 'Farming', herd: 'Herding', fish: 'Fishing', craft: 'Crafting', build: 'Building', forage: 'Hunting & gathering', give: 'Generosity', roam: 'Restlessness' };

export function readableNet(d: DeepNet): string {
  const L = d.layers;
  if (!d.net || !d.acts || L.length !== 4) return '';
  // the inputs in their groups, then the memory
  const order: { i: number; label: string; group?: string; mem?: boolean }[] = [];
  for (const [g, names] of NET_GROUPS) {
    let first = true;
    for (const n of names) { const i = d.senseNames.indexOf(n); if (i >= 0) { order.push({ i, label: NICE[n] ?? n, group: first ? g : undefined }); first = false; } }
  }
  d.senseNames.forEach((n, i) => { if (n.startsWith('memory')) order.push({ i, label: n, group: n === 'memory 1' ? 'Memory' : undefined, mem: true }); });
  const outs = d.outputNames.map((n, j) => ({ j, n })).filter((o) => o.n !== 'hunt');
  const rowH = 17, gap = 16;
  const ys: number[] = [];
  let y = 26;
  for (const o of order) { if (o.group) y += gap; ys.push(y); y += rowH; }
  const H = Math.max(y + 10, 420), W = 560;
  const xs = [150, 270, 370, 430];
  const yIn = new Map(order.map((o, k) => [o.i, ys[k]]));
  const spread = (n: number, k: number) => 40 + (k * (H - 70)) / Math.max(1, n - 1);
  const yAt = (l: number, j: number) => (l === 0 ? yIn.get(j) ?? 0 : l === 3 ? spread(outs.length, outs.findIndex((o) => o.j === j)) : spread(L[l], j));
  let off = 0;
  const lines: string[] = [];
  for (let l = 0; l < 3; l++) {
    const nIn = L[l], nOut = L[l + 1];
    for (let j = 0; j < nOut; j++) {
      if (l === 2 && !outs.some((o) => o.j === j)) continue;
      const ws: [number, number][] = [];
      for (let i = 0; i < nIn; i++) ws.push([i, d.net[off + j * nIn + i]]);
      for (const [i, v] of ws.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3)) {
        const a = Math.min(1, Math.abs(v) / 1.2);
        lines.push(`<line data-from="${l}:${i}" data-to="${l + 1}:${j}" x1="${xs[l]}" y1="${yAt(l, i).toFixed(1)}" x2="${xs[l + 1]}" y2="${yAt(l + 1, j).toFixed(1)}" stroke="${v >= 0 ? '#6cc38a' : '#d9776f'}" stroke-opacity="${(0.25 + a * 0.5).toFixed(2)}" stroke-width="${(0.6 + a * 1.8).toFixed(2)}"/>`);
      }
    }
    off += nIn * nOut + nOut;
  }
  const dot = (cx: number, cy: number, v: number, mem = false, r = 5) => `<circle cx="${cx}" cy="${cy.toFixed(1)}" r="${r}" fill="${mem ? '#b48ead' : v >= 0 ? '#e0a84f' : '#7fb2d9'}" fill-opacity="${(0.3 + Math.min(1, Math.abs(v)) * 0.7).toFixed(2)}" stroke="rgba(255,255,255,0.4)" stroke-width="0.7"/>`;
  let svg = lines.join('');
  order.forEach((o, k) => {
    if (o.group) svg += `<text class="net-group" x="${xs[0] - 12}" y="${(ys[k] - 12).toFixed(1)}" text-anchor="end">${o.group.toUpperCase()}</text>`;
    svg += dot(xs[0], ys[k], d.acts[0][o.i], o.mem) + `<text x="${xs[0] - 12}" y="${(ys[k] + 4).toFixed(1)}" text-anchor="end">${o.label}</text>`;
  });
  d.acts[1].forEach((v, j) => { svg += dot(xs[1], yAt(1, j), v, false, 4); });
  d.acts[2].forEach((v, j) => { svg += dot(xs[2], yAt(2, j), v, false, 4); });
  for (const o of outs) {
    const oy = yAt(3, o.j), mem = o.n.startsWith('memory');
    svg += `<g class="net-out" data-out="${o.j}">${dot(xs[3], oy, Math.tanh(d.acts[3][o.j]), mem, 6)}<text x="${xs[3] + 12}" y="${(oy + 4).toFixed(1)}">${DECIDE[o.n] ?? o.n}</text></g>`;
  }
  return `<svg class="brain-net readable" viewBox="0 0 ${W} ${H}" role="img" aria-label="The culture's neural network">
    <text class="net-col" x="${xs[0]}" y="12" text-anchor="middle">senses</text><text class="net-col" x="${(xs[1] + xs[2]) / 2}" y="12" text-anchor="middle">thinking</text><text class="net-col" x="${xs[3]}" y="12" text-anchor="middle">decides</text>
    ${svg}</svg>
    <div class="legend"><span><i style="background:#6cc38a"></i>adds</span><span><i style="background:#d9776f"></i>holds back</span><span><i style="background:#e0a84f"></i>active now</span><span><i style="background:#b48ead"></i>memory</span><span>· point at a decision to see what feeds it</span></div>`;
}

/** pointing at a decision lights the lines that lead to it, back to the senses */
export function wireNet(root: HTMLElement) {
  const svg = root.querySelector<SVGSVGElement>('svg.readable');
  if (!svg) return;
  const lines = [...svg.querySelectorAll<SVGLineElement>('line')];
  const into = new Map<string, SVGLineElement[]>();
  for (const l of lines) { const k = l.dataset.to!; (into.get(k) ?? into.set(k, []).get(k)!).push(l); }
  svg.querySelectorAll<SVGGElement>('.net-out').forEach((g) => {
    g.addEventListener('pointerenter', () => {
      const lit = new Set<SVGLineElement>();
      let front = [`3:${g.dataset.out}`];
      for (let depth = 0; depth < 3; depth++) {
        const next: string[] = [];
        for (const k of front) for (const l of into.get(k) ?? []) { lit.add(l); next.push(l.dataset.from!); }
        front = next;
      }
      svg.classList.add('focus');
      for (const l of lines) l.classList.toggle('lit', lit.has(l));
    });
    g.addEventListener('pointerleave', () => { svg.classList.remove('focus'); for (const l of lines) l.classList.remove('lit'); });
  });
}

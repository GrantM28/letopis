// The fork's drawing of a clan's neural network for the clan card.
export type BrainNet = { net: number[]; senses: number[]; shape: { inputs: number; hidden: number; outputs: number }; senseNames: string[]; outputNames: string[] };
const SENSE_SHORT = ['spring/autumn', 'winter/summer', 'hunger', 'food stores', 'fruit', 'game', 'fish', 'settled', 'size', 'age', 'warmth'];
const OUT_LABEL: Record<string, string> = { farm: 'Farming', herd: 'Herding', fish: 'Fishing', craft: 'Crafting', build: 'Building', forage: 'Foraging', give: 'Generosity', roam: 'Restlessness' };

/** an SVG of the network: lines are the weights (green adds, red holds back, thicker is stronger), circles light up with the signal */
export function brainSvg(b: BrainNet): string {
  const { inputs: I, hidden: H, outputs: O } = b.shape;
  const net = b.net, x = b.senses;
  if (!net || !x || net.length !== I * H + H + H * O + O) return '';
  const hid: number[] = [];
  for (let j = 0; j < H; j++) { let s = net[I * H + j]; for (let i = 0; i < I; i++) s += net[j * I + i] * x[i]; hid.push(Math.tanh(s)); }
  const base = I * H + H;
  const outs: number[] = [];
  for (let o = 0; o < O; o++) { let s = net[base + H * O + o]; for (let j = 0; j < H; j++) s += net[base + o * H + j] * hid[j]; outs.push(Math.tanh(s / 2)); }
  // the unused hunting output is left out of the picture
  const shown = b.outputNames.map((n, o) => [n, o] as const).filter(([n]) => n !== 'hunt');
  const W = 360, Hh = 250, xi = 92, xh = 180, xo = 268;
  const yI = (i: number) => 14 + (i * (Hh - 28)) / (I - 1);
  const yH = (j: number) => 30 + (j * (Hh - 60)) / (H - 1);
  const yO = (k: number) => 22 + (k * (Hh - 44)) / (shown.length - 1);
  const line = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    const a = Math.min(1, Math.abs(w) / 1.5);
    return `<line x1="${x1}" y1="${y1.toFixed(1)}" x2="${x2}" y2="${y2.toFixed(1)}" stroke="${w >= 0 ? '#6cc38a' : '#d9776f'}" stroke-opacity="${(0.08 + a * 0.6).toFixed(2)}" stroke-width="${(0.4 + a * 1.6).toFixed(2)}"/>`;
  };
  const dot = (cx: number, cy: number, v: number) => `<circle cx="${cx}" cy="${cy.toFixed(1)}" r="5" fill="${v >= 0 ? '#e0a84f' : '#7fb2d9'}" fill-opacity="${(0.25 + Math.min(1, Math.abs(v)) * 0.75).toFixed(2)}" stroke="rgba(255,255,255,0.35)" stroke-width="0.6"/>`;
  let svg = '';
  for (let j = 0; j < H; j++) for (let i = 0; i < I; i++) svg += line(xi, yI(i), xh, yH(j), net[j * I + i]);
  shown.forEach(([, o], k) => { for (let j = 0; j < H; j++) svg += line(xh, yH(j), xo, yO(k), net[base + o * H + j]); });
  for (let i = 0; i < I; i++) svg += dot(xi, yI(i), x[i]) + `<text x="${xi - 9}" y="${(yI(i) + 3.5).toFixed(1)}" text-anchor="end">${SENSE_SHORT[i] ?? ''}</text>`;
  for (let j = 0; j < H; j++) svg += dot(xh, yH(j), hid[j]);
  shown.forEach(([n, o], k) => { svg += dot(xo, yO(k), outs[o]) + `<text x="${xo + 9}" y="${(yO(k) + 3.5).toFixed(1)}">${OUT_LABEL[n] ?? n}</text>`; });
  return `<svg class="brain-net" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="The clan's neural network">${svg}</svg>
    <div class="legend"><span><i style="background:#6cc38a"></i>adds</span><span><i style="background:#d9776f"></i>holds back</span><span><i style="background:#e0a84f"></i>active now</span></div>`;
}

// ---------- Brain 2: the culture's deeper network ----------

export type DeepNet = { layers: number[]; acts: number[][]; net: number[]; senseNames: string[]; outputNames: string[] };
const SHORT: Record<string, string> = { 'age of the world': 'age', 'last period': 'last 2 years', 'friends near': 'friends', 'rivals near': 'rivals', 'food stores': 'stores' };

/** an SVG of the deep network: four columns (senses and memory, two hidden layers, decisions and memory), only the strongest
 *  connections drawn, circles lit by what the clan senses now */
export function deepSvg(d: DeepNet): string {
  const L = d.layers;
  if (!d.net || !d.acts || L.length !== 4) return '';
  const W = 420, Hh = 380, xs = [96, 190, 262, 330];
  const ys = L.map((n) => (i: number) => 12 + (i * (Hh - 24)) / Math.max(1, n - 1));
  // the hunting output is unused: leave it out of the picture
  const hidden = new Set([d.outputNames.indexOf('hunt')]);
  // the outputs drawn evenly without the hidden one
  const shownOut = d.acts[3].map((_, i) => i).filter((i) => !hidden.has(i));
  const yOut = (i: number) => 12 + (shownOut.indexOf(i) * (Hh - 24)) / Math.max(1, shownOut.length - 1);
  ys[3] = yOut;
  let off = 0, svg = '';
  const lines: string[] = [];
  for (let l = 0; l < 3; l++) {
    const nIn = L[l], nOut = L[l + 1];
    const w = d.net.slice(off, off + nIn * nOut);
    off += nIn * nOut + nOut;
    // the strongest fifth of the connections, so the drawing stays readable
    const cut = w.map(Math.abs).sort((a, b) => b - a)[Math.floor(w.length / 5)] ?? 0;
    for (let j = 0; j < nOut; j++) {
      if (l === 2 && hidden.has(j)) continue;
      for (let i = 0; i < nIn; i++) {
        const v = w[j * nIn + i];
        if (Math.abs(v) < cut) continue;
        const a = Math.min(1, Math.abs(v) / 1.2);
        lines.push(`<line x1="${xs[l]}" y1="${ys[l](i).toFixed(1)}" x2="${xs[l + 1]}" y2="${ys[l + 1](j).toFixed(1)}" stroke="${v >= 0 ? '#6cc38a' : '#d9776f'}" stroke-opacity="${(0.1 + a * 0.5).toFixed(2)}" stroke-width="${(0.3 + a * 1.2).toFixed(2)}"/>`);
      }
    }
  }
  svg += lines.join('');
  const dot = (cx: number, cy: number, v: number, mem = false) => `<circle cx="${cx}" cy="${cy.toFixed(1)}" r="${mem ? 4 : 4.5}" fill="${mem ? '#b48ead' : v >= 0 ? '#e0a84f' : '#7fb2d9'}" fill-opacity="${(0.25 + Math.min(1, Math.abs(v)) * 0.75).toFixed(2)}" stroke="rgba(255,255,255,0.35)" stroke-width="0.6"/>`;
  d.acts[0].forEach((v, i) => {
    const name = d.senseNames[i] ?? '';
    const mem = name.startsWith('memory');
    svg += dot(xs[0], ys[0](i), v, mem) + `<text x="${xs[0] - 8}" y="${(ys[0](i) + 3.5).toFixed(1)}" text-anchor="end">${SHORT[name] ?? name}</text>`;
  });
  d.acts[1].forEach((v, i) => { svg += dot(xs[1], ys[1](i), v); });
  d.acts[2].forEach((v, i) => { svg += dot(xs[2], ys[2](i), v); });
  d.acts[3].forEach((v, i) => {
    if (hidden.has(i)) return;
    const name = d.outputNames[i] ?? '';
    const mem = name.startsWith('memory');
    svg += dot(xs[3], ys[3](i), Math.tanh(v), mem) + `<text x="${xs[3] + 8}" y="${(ys[3](i) + 3.5).toFixed(1)}">${OUT_LABEL[name] ?? name}</text>`;
  });
  return `<svg class="brain-net" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="The culture's neural network">${svg}</svg>
    <div class="legend"><span><i style="background:#6cc38a"></i>adds</span><span><i style="background:#d9776f"></i>holds back</span><span><i style="background:#e0a84f"></i>active now</span><span><i style="background:#b48ead"></i>memory</span></div>`;
}

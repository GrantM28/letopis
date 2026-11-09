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

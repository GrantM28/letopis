// The map's extra layers (cultures, trade, realms: fork) share one rule: while any layer that names land is on and the
// map is zoomed out, the clans' own name tags step back so the layer can be read. Close in, the tags come back.
import type { Container } from 'pixi.js';
import type { WorldRenderer } from './render';

const layers: { on(): boolean }[] = [];
let hidden = false;

/** a layer container: never hidden with the tags */
export function markOverlay(c: Container) { c.label = 'overlay'; }

/** a layer that wants the tags out of the way while it is on */
export function wantsQuietTags(layer: { on(): boolean }) { layers.push(layer); }

/** every frame */
export function syncTags(r: WorldRenderer, zoom: number) {
  const hide = zoom < 0.9 && layers.some((l) => l.on());
  if (!hide && !hidden) return;
  for (const ch of r.labelLayer.children) if (ch.label !== 'overlay') ch.visible = !hide;
  hidden = hide;
}

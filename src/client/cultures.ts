// The Cultures button (fork, 1.53): turns the culture layer on and off, keeps the list of cultures fresh while it is on,
// and colours the minimap's dots by culture.
import { CultureInfo, CultureLayer, hueCss } from './culturelayer';
import type { Minimap } from './minimap';
import type { WorldRenderer } from './render';
import { syncTags } from './overlays';
import { $, api, save, store } from './kit';

export let cultureLayer: CultureLayer | null = null;

export function initCultures(r: WorldRenderer, mini: Minimap | null, zoom: () => number) {
  const layer = (cultureLayer = new CultureLayer(r));
  r.onBands = (bands) => layer.update(bands);
  const btn = $('#culturesBtn');
  let fetched = 0;
  const refresh = async () => {
    const list = await api<CultureInfo[]>('/api/cultures').catch(() => null);
    if (list) { layer.setCultures(list); fetched = performance.now(); }
  };
  const apply = (on: boolean) => {
    layer.setOn(on);
    btn.setAttribute('aria-pressed', String(on));
    if (mini) mini.colorOf = on ? (b) => (b.culture !== undefined && layer.cultures.has(b.culture) ? hueCss(layer.cultures.get(b.culture)!.hue) : null) : null;
    if (on && performance.now() - fetched > 5000) void refresh();
  };
  btn.onclick = () => { const on = !layer.on; save('letopis.cultures', on); apply(on); };
  apply(store('letopis.cultures', false));
  // cultures split and copy each other every few years of the world: a fresh list now and then while the layer is on
  setInterval(() => { if (layer.on) void refresh(); }, 15000);
  r.app.ticker.add(() => { layer.frame(zoom()); syncTags(r, zoom()); });
}

// Realms on the page (fork, 1.59): the Realms button draws every realm's land with a border, its name and a crown on its
// capital; a realm card tells its ruler, house, capital, villages and past rulers.
import { AlphaFilter, Container, Graphics, Text } from 'pixi.js';
import type { BandView } from '../shared/types';
import { TH, TW, type WorldRenderer } from './render';
import { hueColor, hueCss } from './culturelayer';
import { fmtYear, num } from './lang';
import { $, api, esc, save, store, ui } from './kit';
import { markOverlay, wantsQuietTags } from './overlays';
import { cardHtml, chip, mountCard } from './cardkit';

export interface RealmInfo { id: number; name: string; hue: number; capital: number; members: number[]; ruler: string | null }
interface RealmCard {
  id: number; name: string; hue: number; since: number; kind: string;
  capital: { id: number; name: string } | null;
  ruler: { id: number; name: string; sex: number; since: number; house: string; n: number; title: string } | null;
  past: { id: number; name: string; since: number; house: string; n: number }[];
  villages: { id: number; name: string; size: number }[];
  people: number;
}

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const REACH = 7;

export class RealmLayer {
  c = new Container();
  private land = new Container();
  private edge = new Graphics();
  private fill = new Graphics();
  private names = new Container();
  private labels = new Map<number, Text>();
  realms: RealmInfo[] = [];
  on = false;
  private bands: BandView[] = [];

  constructor(private r: WorldRenderer) {
    r.labelLayer.addChildAt(this.c, Math.min(2, r.labelLayer.children.length));
    markOverlay(this.c);
    wantsQuietTags({ on: () => this.on });
    // borders: every village's land drawn a little larger in a dark edge colour, then its fill over it; only the outer
    // edge of the realm's land stays dark. The whole is see-through so the land shows.
    this.land.addChild(this.edge, this.fill);
    this.land.filters = [new AlphaFilter({ alpha: 0.5 })];
    this.c.addChild(this.land, this.names);
    this.c.visible = false;
    this.c.eventMode = 'none';
  }

  setOn(on: boolean) { this.on = on; this.c.visible = on; if (on) this.draw(); }
  setRealms(list: RealmInfo[]) { this.realms = list; if (this.on) this.draw(); }
  update(bands: BandView[]) { this.bands = bands; if (this.on) this.draw(); }

  frame(zoom: number) {
    if (!this.on) return;
    for (const t of this.labels.values()) t.scale.set(1 / Math.max(0.15, zoom));
  }

  /** the realm whose land is at a map point (the nearest village within reach) */
  realmAt(tx: number, ty: number): RealmInfo | null {
    const byBand = new Map<number, RealmInfo>();
    for (const r of this.realms) for (const m of r.members) byBand.set(m, r);
    let best: RealmInfo | null = null, bd = REACH * REACH;
    for (const b of this.bands) {
      const r = byBand.get(b.id);
      const d = (b.x - tx) ** 2 + (b.y - ty) ** 2;
      if (r && d < bd) { bd = d; best = r; }
    }
    return best;
  }

  private draw() {
    const byId = new Map(this.bands.map((b) => [b.id, b]));
    const rx = REACH * TW * 0.62, ry = REACH * TH * 0.62;
    this.edge.clear(); this.fill.clear();
    const seen = new Set<number>();
    for (const r of this.realms) {
      const vs = r.members.map((m) => byId.get(m)).filter(Boolean) as BandView[];
      if (!vs.length) continue;
      for (const b of vs) { const p = this.r.tileTop(b.x, b.y); this.edge.ellipse(p.x, p.y, rx + 7, ry + 4).fill({ color: hueColor(r.hue, 0.22) }); }
      for (const b of vs) { const p = this.r.tileTop(b.x, b.y); this.fill.ellipse(p.x, p.y, rx, ry).fill({ color: hueColor(r.hue, 0.52) }); }
      // the name over the realm, a crown over its capital
      const cap = byId.get(r.capital) ?? vs[0];
      const cp = this.r.tileTop(cap.x, cap.y);
      seen.add(r.id);
      let t = this.labels.get(r.id);
      if (!t) {
        t = new Text({ text: '', resolution: 2, style: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: '700', fill: 0xfff2d0, stroke: { color: 0x1a120a, width: 5 }, letterSpacing: 1 } });
        t.anchor.set(0.5, 1);
        this.labels.set(r.id, t);
        this.names.addChild(t);
      }
      t.text = `♛ ${r.name}`;
      t.position.set(cp.x, cp.y - 46);
    }
    for (const [id, t] of this.labels) if (!seen.has(id)) { t.destroy(); this.labels.delete(id); }
  }
}

export let realmLayer: RealmLayer | null = null;

export function initRealms(r: WorldRenderer, zoom: () => number) {
  const layer = (realmLayer = new RealmLayer(r));
  const prev = r.onBands;
  r.onBands = (bands) => { prev?.(bands); layer.update(bands); };
  const btn = $('#realmsBtn');
  const refresh = async () => { const list = await api<RealmInfo[]>('/api/realms').catch(() => null); if (list) layer.setRealms(list); };
  const apply = (on: boolean) => { layer.setOn(on); btn.setAttribute('aria-pressed', String(on)); if (on) void refresh(); };
  btn.onclick = () => { const on = !layer.on; save('letopis.realms', on); apply(on); };
  apply(store('letopis.realms', false));
  setInterval(() => { if (layer.on) void refresh(); }, 20000);
  r.app.ticker.add(() => layer.frame(zoom()));
  void refresh();
}

/** the realm a village belongs to (for its card), from the last list */
export async function realmOfBand(bandId: number): Promise<RealmInfo | null> {
  // always fresh: rulers change between the map's refreshes
  const list = await api<RealmInfo[]>('/api/realms').catch(() => realmLayer?.realms ?? []);
  return list.find((x) => x.members.includes(bandId)) ?? null;
}

export async function showRealm(id: number) {
  const c = await api<RealmCard>(`/api/realm/${id}`).catch(() => null);
  if (!c) { ui.openCard('<h2>A realm that is no more</h2><p class="muted">Its villages have gone their own ways.</p>'); return; }
  const color = hueCss(c.hue, 0.6);
  const ru = c.ruler;
  const houses = new Set([...c.past.map((p) => p.house), ...(ru ? [ru.house] : [])]).size;
  const spec = {
    kind: 'realm', dot: color, title: `The ${c.name}`,
    facts: `${c.kind === 'Empire' ? 'an' : 'a'} ${esc(c.kind.toLowerCase())} · since ${fmtYear(c.since)}`,
    chips: [
      ...(ru ? [chip('👑', `${esc(ru.title[0].toUpperCase() + ru.title.slice(1))} ${esc(ru.name)}`, `data-person="${ru.id}"`)] : [chip('', 'The throne is empty')]),
      ...(c.capital ? [chip('🏛', `Capital: ${esc(c.capital.name)}`, `data-band="${c.capital.id}"`)] : []),
    ],
    stats: [['villages', String(c.villages.length)], ['people', num(c.people)], ['rulers so far', String(c.past.length + (ru ? 1 : 0))], ['ruling houses', String(houses)]] as [string, string][],
    help: 'realms',
    tabs: [
      { id: 'overview', label: 'Overview', render: (el: HTMLElement) => {
        el.innerHTML = `${ru ? `<h3>Its ${esc(ru.title)}</h3><p><a href="#" class="ref" data-person="${ru.id}"><b>${esc(ru.name)}</b></a>, the ${ORD[ru.n] ?? `${ru.n}th`} of the ${esc(ru.house)}, rules since ${fmtYear(ru.since)}.</p>` : '<p class="muted">The throne is empty.</p>'}
          <p class="ck-note">In a hungry year its villages send food to the hungriest of them. A village that turns against the capital leaves.</p>`;
      } },
      { id: 'villages', label: `Villages (${c.villages.length})`, render: (el: HTMLElement) => {
        el.innerHTML = `<ul class="bands">${c.villages.map((v) => `<li data-band="${v.id}"><span class="dot" style="background:${color}"></span><div><b>${esc(v.name)}</b>${c.capital?.id === v.id ? ' <span class="badge village">capital</span>' : ''}<div class="muted">${num(v.size)} people</div></div></li>`).join('')}</ul>`;
      } },
      { id: 'rulers', label: 'Rulers', render: (el: HTMLElement) => {
        const all = [...(ru ? [{ ...ru, now: true }] : []), ...c.past.map((p) => ({ ...p, now: false }))];
        el.innerHTML = all.length ? `<ul class="plain">${all.map((p) => `<li>${fmtYear(p.since)}: <a href="#" class="ref" data-person="${p.id}">${esc(p.name)}</a> <span class="muted">· ${ORD[p.n] ?? `${p.n}th`} of the ${esc(p.house)}${p.now ? ' · rules now' : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No ruler yet.</p>';
      } },
    ],
  };
  ui.openCard(cardHtml(spec));
  mountCard(spec);

}

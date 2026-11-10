// A small overview of the whole world in the corner: the explored land in its colours, every clan as a dot,
// and the part the camera shows as a frame. Click or drag on it to go there.

import type { BandView, WorldInfo } from '../shared/types';
import { b64decode } from '../shared/types';
import { BIOME_RGB } from '../shared/biomecolors';


export class Minimap {
  private canvas: HTMLCanvasElement;
  private base = document.createElement('canvas');
  private biome: Uint8Array;
  private river: Uint8Array;
  private w: number;
  private h: number;
  /** the iso transform of the map into the canvas */
  private s = 1;
  private ox = 0;
  private oy = 0;
  onPick: (x: number, y: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement, info: WorldInfo) {
    this.canvas = canvas;
    this.w = info.w;
    this.h = info.h;
    this.biome = b64decode(info.biome);
    this.river = b64decode(info.river);
    this.base.width = this.w;
    this.base.height = this.h;
    let down = false;
    const pick = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const t = this.toTile(e.clientX - r.left, e.clientY - r.top);
      this.onPick(Math.max(0, Math.min(this.w - 1, t.x)), Math.max(0, Math.min(this.h - 1, t.y)));
    };
    canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); pick(e); });
    canvas.addEventListener('pointermove', (e) => { if (down) pick(e); });
    canvas.addEventListener('pointerup', () => { down = false; });
    canvas.addEventListener('pointercancel', () => { down = false; });
  }

  /** the land the clans have seen, in its colours; the rest stays dark */
  setExplored(explored: Uint8Array) {
    const g = this.base.getContext('2d')!;
    const img = g.createImageData(this.w, this.h);
    for (let i = 0; i < this.w * this.h; i++) {
      const o = i * 4;
      if (!explored[i]) { img.data[o] = 16; img.data[o + 1] = 22; img.data[o + 2] = 36; img.data[o + 3] = 255; continue; }
      const c = this.river[i] > 40 ? BIOME_RGB[1] : BIOME_RGB[this.biome[i]] ?? [90, 90, 90];
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  private fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(W * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    // the diamond of the map is (w + h) wide and (w + h) / 2 tall in iso units
    this.s = Math.min(W / (this.w + this.h), (H * 2) / (this.w + this.h)) * 0.98;
    this.ox = W / 2 - ((this.w - this.h) / 2) * this.s;
    this.oy = H / 2 - ((this.w + this.h) / 4) * this.s;
    return dpr;
  }

  private toMini(x: number, y: number) {
    return { x: this.ox + (x - y) * this.s, y: this.oy + ((x + y) * this.s) / 2 };
  }

  private toTile(mx: number, my: number) {
    const a = (mx - this.ox) / this.s, b = ((my - this.oy) * 2) / this.s;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  /** corners: the four screen corners as tiles */
  /** a colour for a clan's dot instead of its own (fork: the culture layer); null keeps the clan's colour */
  colorOf: ((b: BandView) => string | null) | null = null;

  draw(bands: BandView[], corners: { x: number; y: number }[], selected: number | null) {
    const dpr = this.fit();
    const g = this.canvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.s * dpr, (this.s / 2) * dpr, -this.s * dpr, (this.s / 2) * dpr, this.ox * dpr, this.oy * dpr);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const b of bands) {
      const p = this.toMini(b.x, b.y);
      const r = b.settled ? 3 : 2;
      g.fillStyle = this.colorOf?.(b) ?? `#${b.color.toString(16).padStart(6, '0')}`;
      g.strokeStyle = b.id === selected ? '#ffffff' : 'rgba(0,0,0,0.6)';
      g.lineWidth = b.id === selected ? 2 : 1;
      g.beginPath();
      if (b.settled) g.rect(p.x - r, p.y - r, r * 2, r * 2); else g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
    if (corners.length === 4) {
      g.strokeStyle = 'rgba(255, 236, 190, 0.9)';
      g.lineWidth = 1.2;
      g.beginPath();
      corners.forEach((c, i) => { const p = this.toMini(c.x, c.y); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
      g.closePath();
      g.stroke();
    }
  }
}

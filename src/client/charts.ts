// Small canvas charts for the statistics: lines over the years with the ages shaded behind, and bar lists.
// Sharp on any screen, themed from the CSS variables, with a hover readout.

export interface Series { name: string; color: string; values: number[]; fill?: boolean; dashed?: boolean }
export interface LineChartOpts {
  xs: number[]; // the years
  series: Series[];
  /** the age of each point, to shade where each age began */
  eras?: number[];
  eraNames?: string[];
  fmtX: (x: number) => string;
  fmtY?: (y: number) => string;
  height?: number;
}

const css = (v: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;

export function lineChart(holder: HTMLElement, o: LineChartOpts) {
  const h = o.height ?? 170;
  holder.classList.add('chart');
  holder.innerHTML = `<canvas style="height:${h}px"></canvas><div class="chart-tip" hidden></div>
    <div class="legend">${o.series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;
  const c = holder.querySelector('canvas')!;
  const tip = holder.querySelector<HTMLElement>('.chart-tip')!;
  const fmtY = o.fmtY ?? ((y: number) => Math.round(y).toLocaleString('en-US'));
  const draw = (hover = -1) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth || 320, H = h;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const pad = { l: 40, r: 8, t: 8, b: 20 };
    const n = o.xs.length;
    if (n < 2) {
      g.fillStyle = css('--muted', '#9aa3b5'); g.font = '12px system-ui';
      g.fillText('Not enough history yet: check back in a little while.', 8, H / 2);
      return;
    }
    const max = Math.max(1, ...o.series.flatMap((s) => s.values)) * 1.08;
    const X = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
    const Y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
    // ages shaded in turn
    if (o.eras) {
      let start = 0;
      for (let i = 1; i <= n; i++) {
        if (i === n || o.eras[i] !== o.eras[start]) {
          if (o.eras[start] % 2) { g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(X(start), pad.t, X(i - 1) - X(start), H - pad.t - pad.b); }
          if (start > 0 && o.eraNames) {
            g.strokeStyle = 'rgba(224,168,79,0.35)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(start), pad.t); g.lineTo(X(start), H - pad.b); g.stroke(); g.setLineDash([]);
            g.fillStyle = 'rgba(224,168,79,0.8)'; g.font = '10px system-ui';
            g.fillText(o.eraNames[o.eras[start]] ?? '', X(start) + 3, pad.t + 10);
          }
          start = i;
        }
      }
    }
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.fillStyle = css('--muted', '#9aa3b5'); g.font = '10px system-ui'; g.lineWidth = 1;
    for (let k = 0; k <= 3; k++) {
      const v = (max / 1.08) * (k / 3), y = Y(v);
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke();
      g.fillText(compact(v), 4, y + 3);
    }
    g.fillText(o.fmtX(o.xs[0]), pad.l, H - 5);
    const end = o.fmtX(o.xs[n - 1]);
    g.fillText(end, W - pad.r - g.measureText(end).width, H - 5);
    // lines
    for (const s of o.series) {
      g.strokeStyle = s.color; g.lineWidth = 2; g.setLineDash(s.dashed ? [4, 3] : []);
      g.beginPath();
      s.values.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
      g.stroke();
      g.setLineDash([]);
      if (s.fill) {
        g.lineTo(X(n - 1), Y(0)); g.lineTo(X(0), Y(0)); g.closePath();
        const grad = g.createLinearGradient(0, pad.t, 0, H - pad.b);
        grad.addColorStop(0, s.color + '55'); grad.addColorStop(1, s.color + '05');
        g.fillStyle = grad; g.fill();
      }
    }
    if (hover >= 0) {
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.moveTo(X(hover), pad.t); g.lineTo(X(hover), H - pad.b); g.stroke();
      for (const s of o.series) { g.fillStyle = s.color; g.beginPath(); g.arc(X(hover), Y(s.values[hover]), 3, 0, Math.PI * 2); g.fill(); }
    }
  };
  draw();
  const pick = (ev: PointerEvent) => {
    const r = c.getBoundingClientRect();
    const n = o.xs.length;
    if (n < 2) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - r.left - 40) / (r.width - 48)) * (n - 1))));
    draw(i);
    tip.hidden = false;
    tip.innerHTML = `<b>${o.fmtX(o.xs[i])}</b>${o.series.map((s) => `<div><i style="background:${s.color}"></i>${s.name}: ${fmtY(s.values[i])}</div>`).join('')}`;
    const left = ev.clientX - r.left;
    tip.style.left = `${Math.min(r.width - 150, Math.max(0, left + 10))}px`;
  };
  c.addEventListener('pointermove', pick);
  c.addEventListener('pointerleave', () => { tip.hidden = true; draw(); });
  new ResizeObserver(() => draw()).observe(c);
}

/** a list of labelled bars, longest first */
export function barList(rows: [string, number][], color = 'var(--accent-2)', limit = 10): string {
  const top = rows.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!top.length) return '<p class="muted">Nothing yet.</p>';
  const max = top[0][1];
  return `<div class="barlist">${top.map(([k, v]) => `<div class="barrow"><span class="bl-k">${k}</span><span class="bl-v">${v.toLocaleString('en-US')}</span>
    <div class="bl-bar"><i style="width:${(v / max) * 100}%;background:${color}"></i></div></div>`).join('')}</div>`;
}

export function compact(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

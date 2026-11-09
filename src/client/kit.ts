// What the fork's page modules (help.ts, dashboard.ts) share: tiny helpers and a doorway into main.ts.
// main.ts fills the doorway once with setUi(); the modules never reach into main.ts otherwise.
import type { BandView, PersonRow } from '../shared/types';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function api<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

export interface ForkUi {
  bands(): BandView[];
  people(): PersonRow[];
  activeTab(): string;
  currentEra(): number;
  knownNow(): Set<string>;
  eraName(e: number): string;
  techLabel(id: string): string;
  gates: Map<number, string>;
  icon: Record<string, string>;
  openCard(html: string, beside?: boolean, extra?: string): void;
  /** look at a clan on the map */
  focusBand(b: BandView): void;
  /** draw the side panel again */
  rerender(): void;
}

export let ui: ForkUi;
export function setUi(u: ForkUi) { ui = u; }

export function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

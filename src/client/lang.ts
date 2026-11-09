// The page language: Bulgarian or English, chosen with the language button and remembered in the browser.
// The server sends Bulgarian names and a ready English chronicle; the rest is translated here.

import {
  BIOME_NAMES_EN, Lang, MONTHS_EN, SECRET_HEROES_EN, SECRET_KINDS_EN, TECH_EN, bandEn, bandTextEn, causeEn, chiefEn, deedEn,
  eraEn, personEn, taskEn, techEn, titleEn, translit, yearsInTextEn, GENE_EN,
} from '../shared/i18n';
import { MONTHS, formatYear } from '../shared/types';
import { clanBase } from '../shared/clans';
import { SECRET_HEROES, SECRET_KINDS } from '../shared/secrets';

/** this version of the game is English only (the server still writes Bulgarian beside the English) */
function initial(): Lang {
  return 'en';
}

export const LANG: Lang = initial();
export const EN = LANG === 'en';

export function setLang(l: Lang) {
  try { localStorage.setItem('letopis.lang', JSON.stringify(l)); } catch { /* private mode */ }
  location.reload();
}

/** pick the text for the current language */
export const T = (bg: string, en: string) => (EN ? en : bg);

export const fmtYear = (y: number) => formatYear(y, LANG);
export const monthName = (m: number) => (EN ? MONTHS_EN : MONTHS)[m];
export const num = (n: number) => n.toLocaleString(EN ? 'en-US' : 'bg-BG');

// names and words that come from the server in Bulgarian
export const P = (name: string) => (EN ? personEn(name) : name);
/** a band name ("Родът на Вълка") */
export const B = (name: string) => (EN ? bandEn(name) : name);
/** a band label written by the server ("Селото Бялово", "Родът на ...", "рода на ...") */
export const BL = (s: string) => (EN ? bandTextEn(s) : s);
export const VILLAGE = (s: string) => (EN ? translit(s) : s);
export const TECH = (bgName: string) => (EN ? techEn(bgName) : bgName);
export const TECH_ID = (id: string, bgName: string) => (EN ? TECH_EN[id]?.name ?? bgName : bgName);
export const ERA = (s: string) => (EN ? eraEn(s) : s);
export const TASK = (s: string) => (EN ? taskEn(s) : s);
export const CAUSE = (s: string) => (EN ? causeEn(s) : s);
export const DEED = (s: string) => (EN ? deedEn(s) : s);
export const TITLE = (s: string) => (EN ? titleEn(s) : s);
export const CHIEF = (s: string) => (EN ? chiefEn(s) : s);
export const GENE = (s: string) => (EN ? GENE_EN[s] ?? s : s);
export const YEARS_IN = (s: string) => (EN ? yearsInTextEn(s) : s);
export const HERO = (k: number) => (EN ? SECRET_HEROES_EN[k] : SECRET_HEROES[k]);
export const SECRET_KIND = (kind: number) => {
  const s = SECRET_KINDS[kind];
  return EN ? SECRET_KINDS_EN[s.id] ?? s : s;
};
export const BIOME_EN = BIOME_NAMES_EN;

/** a chronicle name ref, as it is written in the current language */
export function refName(n: string, isPerson: boolean): string {
  if (!EN) return n;
  if (isPerson) return personEn(n);
  return /^(Родът|рода) на /.test(n) || clanBase(n) ? bandEn(n) : translit(n);
}

/** the static page in English (index.html is written in Bulgarian) */
export function translatePage() {
  document.documentElement.lang = LANG;
  if (!EN) return;
  const set = (sel: string, text?: string, title?: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return;
    if (text !== undefined) el.textContent = text;
    if (title !== undefined) { el.title = title; if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', title); }
  };
  set('#loading', 'The world is waking up…');
  set('#conn', undefined, 'Connection to the server');
  const brand = document.querySelector('.brand');
  if (brand?.firstChild) brand.firstChild.textContent = 'Letopis ';
  document.title = document.title.replace('Летопис', 'Letopis');
  const stats: [string, string][] = [['#pop', 'People'], ['#bandsCount', 'Clans'], ['#born', 'Born'], ['#died', 'Died'], ['#age', 'Running for']];
  for (const [id, label] of stats) {
    const span = document.querySelector(id)?.previousElementSibling;
    if (span) span.textContent = label;
  }
  set('#sideHandle', undefined, 'Hide or show the panel');
  const tabs: Record<string, string> = { chronicle: 'Chronicle', discoveries: 'Discoveries', bands: 'Clans', heroes: 'People', stats: 'Stats', secrets: 'Secrets' };
  for (const [k, v] of Object.entries(tabs)) { set(`.tab[data-tab="${k}"] .lbl`, v); set(`.tab[data-tab="${k}"]`, undefined, v); }
  set('#zoomIn', undefined, 'Zoom in');
  set('#zoomOut', undefined, 'Zoom out');
  set('#homeBtn', undefined, 'Show all the clans');
  set('#tourBtn .lbl', 'Tour');
  set('#tourBtn', undefined, 'The camera wanders the world on its own');
  set('#nightBtn .lbl', 'Night');
  set('#nightBtn', undefined, 'Day and night cycle');
  set('#kidsBtn .lbl', 'Kids mode');
  set('#kidsBtn', undefined, 'Bigger letters and explanations for children');
  set('#sideToggle .lbl', 'Panel');
  set('#sideToggle', undefined, 'Hide or show the chronicle');
  set('#ageLabel', 'Discoveries of this age');
  set('#cardClose', undefined, 'Close');
}

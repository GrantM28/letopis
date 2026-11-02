// Shared between server and browser.

export const enum Biome {
  DeepWater = 0,
  Water = 1,
  Beach = 2,
  Grassland = 3,
  Plains = 4,
  Forest = 5,
  Taiga = 6,
  Hills = 7,
  Mountain = 8,
  Snow = 9,
  Desert = 10,
  Tundra = 11,
  Marsh = 12,
  Lake = 13,
}

export const BIOME_NAMES: Record<number, string> = {
  0: 'Дълбоко море',
  1: 'Море',
  2: 'Бряг',
  3: 'Ливади',
  4: 'Равнина',
  5: 'Широколистна гора',
  6: 'Иглолистна гора',
  7: 'Хълмове',
  8: 'Планина',
  9: 'Вечен сняг',
  10: 'Пустош',
  11: 'Тундра',
  12: 'Блато',
  13: 'Езеро',
};

/** river flow from which a river is wide enough to be drawn as water (and no camp stands on it) */
export const RIVER_WATER = 40;

export function isWater(b: number): boolean {
  return b === Biome.DeepWater || b === Biome.Water || b === Biome.Lake;
}

export type Task = 'rest' | 'gather' | 'hunt' | 'fish' | 'craft' | 'farm' | 'herd' | 'build' | 'child' | 'elder' | 'travel' | 'lead' | 'scout' | 'chop';

export const TASK_NAMES: Record<Task, string> = {
  rest: 'почива',
  gather: 'събира плодове и корени',
  hunt: 'ловува',
  fish: 'лови риба',
  craft: 'прави сечива',
  farm: 'обработва нивата',
  herd: 'пасе животните',
  build: 'строи',
  child: 'играе',
  elder: 'разказва истории',
  travel: 'пътува',
  lead: 'води рода',
  scout: 'търси ново място за лагера',
  chop: 'сече дърва',
};

/** the head of a band or a village, by era: always the oldest man */
export const CHIEF_TITLES = ['Старейшина', 'Старейшина', 'Вожд', 'Княз', 'Кмет', 'Кмет', 'Кмет', 'Кмет', 'Кмет'];

export interface WorldInfo {
  worldId: string;
  seed: number;
  w: number;
  h: number;
  /** base64 Uint8 arrays, row-major, w*h each */
  height: string;
  biome: string;
  river: string;
  temp: string;
  /** which tree can grow on each tile (index into TREE_KINDS, 0 none) */
  treeKinds: string;
}

export interface TimeInfo {
  tick: number;
  /** calendar year, negative = преди новата ера */
  year: number;
  month: number; // 0..11
  era: number;
  eraName: string;
  /** real milliseconds between ticks right now */
  tickMs: number;
  startedAt: number; // real time ms when this world began
}

export interface BandView {
  id: number;
  name: string;
  color: number;
  x: number;
  y: number;
  settled: boolean;
  settlementName: string | null;
  techs: string[];
  /** tech ids, for the page to decide what it draws */
  techIds: string[];
  /** the head of the band: name and title */
  chief: { id: number; name: string; title: string } | null;
  /** who founded the band and which band they came from (null for the first bands) */
  founder?: { id: number; name: string } | null;
  from?: { id: number; name: string } | null;
  size: number;
  food: number;
  founded: number; // year
  hasFire: boolean;
  dwelling: 'none' | 'tent' | 'hut' | 'house';
}

/** compact person: [id, x*10, y*10, taskIndex, bandId, ageYears, sex(0 m,1 f), chief(1) or not(0)] */
export type PersonRow = [number, number, number, number, number, number, number, number];

export const TASKS: Task[] = ['rest', 'gather', 'hunt', 'fish', 'craft', 'farm', 'herd', 'build', 'child', 'elder', 'travel', 'lead', 'scout', 'chop'];

export interface ChronicleEntry {
  id: number;
  tick: number;
  year: number;
  kind: string;
  importance: number; // 1 small, 2 notable, 3 big
  text: string;
  /** text for kids mode, if different */
  kids?: string;
  personId?: number;
  bandId?: number;
  /** names in the text that lead somewhere: a person (p) or a band (b) */
  refs?: ChronicleRef[];
  /** the same entry in English (entries written before v1.15 have none) */
  en?: { text: string; kids?: string };
}

export interface ChronicleRef { n: string; p?: number; b?: number }

/** a band that is no more: what the chronicle still knows about it */
export interface GoneBand {
  id: number;
  name: string;
  settlementName: string | null;
  color: number;
  foundedYear: number;
  endedYear: number;
  /** 'extinct' or the name of the band it joined */
  end: string;
  techs: string[];
  founder?: { id: number; name: string } | null;
  from?: { id: number; name: string } | null;
}

export interface TickMessage {
  t: 'tick';
  time: TimeInfo;
  bands: BandView[];
  people: PersonRow[];
  events: ChronicleEntry[];
  explored?: string; // base64 bitset, only when changed
  /** trees that grew or were cut: [tile, stage, tile, stage, ...] */
  trees?: number[];
  population: number;
}

export interface SnapshotMessage {
  t: 'snapshot';
  time: TimeInfo;
  bands: BandView[];
  people: PersonRow[];
  explored: string;
  /** size of every tree, one byte per tile (0 none .. 4 big), base64 */
  trees: string;
  population: number;
  totalBorn: number;
  totalDied: number;
}

export interface PersonDetail {
  id: number;
  name: string;
  sex: 0 | 1;
  bornYear: number;
  diedYear: number | null;
  age: number;
  cause: string | null;
  bandName: string;
  task: string;
  genes: Record<string, number>;
  mother: { id: number; name: string } | null;
  father: { id: number; name: string } | null;
  partner: { id: number; name: string } | null;
  children: { id: number; name: string; alive: boolean }[];
  deeds: string[];
  generation: number;
  /** "Старейшина на Родът на ..." when the person leads a band */
  title: string | null;
}

/** one person in the family tree */
export interface TreeNode {
  id: number;
  name: string;
  sex: 0 | 1;
  bornYear: number;
  diedYear: number | null;
  generation: number;
  mother?: TreeNode | null;
  father?: TreeNode | null;
}

export interface FamilyTree {
  root: TreeNode;
  /** mother's mother's ... line and father's father's ... line up to the first people, nearest first */
  motherLine: TreeNode[];
  fatherLine: TreeNode[];
}

export function formatYear(year: number, lang: 'bg' | 'en' = 'bg'): string {
  if (lang === 'en') {
    const e = Math.abs(Math.round(year)).toLocaleString('en-US');
    return year < 0 ? `${e} BC` : `AD ${e}`;
  }
  const y = Math.abs(Math.round(year));
  const s = y.toLocaleString('bg-BG').replace(/ /g, ' ');
  return year < 0 ? `${s} г. пр.н.е.` : `${s} г.`;
}

export const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

export function b64encode(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** a first discovery ever */
export interface Discovery { tech: string; name: string; pid: number | null; who: string; band: string; year: number }

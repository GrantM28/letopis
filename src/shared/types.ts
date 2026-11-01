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

export function isWater(b: number): boolean {
  return b === Biome.DeepWater || b === Biome.Water || b === Biome.Lake;
}

export type Task = 'rest' | 'gather' | 'hunt' | 'fish' | 'craft' | 'farm' | 'herd' | 'build' | 'child' | 'elder' | 'travel';

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
};

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
  size: number;
  food: number;
  founded: number; // year
  hasFire: boolean;
  dwelling: 'none' | 'tent' | 'hut' | 'house';
}

/** compact person: [id, x*10, y*10, taskIndex, bandId, ageYears, sex(0 m,1 f)] */
export type PersonRow = [number, number, number, number, number, number, number];

export const TASKS: Task[] = ['rest', 'gather', 'hunt', 'fish', 'craft', 'farm', 'herd', 'build', 'child', 'elder', 'travel'];

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
}

export interface TickMessage {
  t: 'tick';
  time: TimeInfo;
  bands: BandView[];
  people: PersonRow[];
  events: ChronicleEntry[];
  explored?: string; // base64 bitset, only when changed
  population: number;
}

export interface SnapshotMessage {
  t: 'snapshot';
  time: TimeInfo;
  bands: BandView[];
  people: PersonRow[];
  explored: string;
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
}

export function formatYear(year: number): string {
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

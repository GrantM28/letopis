import { Rng } from './rng';
import { Biome, isWater, RIVER_WATER } from './types';

/** 100 secrets hidden in every world. Where they lie follows from the world seed, so server and page agree. */
export const SECRET_COUNT = 100;

export interface SecretKind {
  id: string;
  name: string;
  text: string;
  /** biomes it likes; it can still turn up elsewhere */
  likes: number[];
}

export const SECRET_KINDS: SecretKind[] = [
  { id: 'ufo', name: 'летяща чиния', text: 'Тиха сребърна чиния виси ниско над тревата и свети. Никой в летописа не знае откъде е дошла.', likes: [Biome.Plains, Biome.Grassland, Biome.Desert] },
  { id: 'meteor', name: 'паднал метеорит', text: 'Камък от небето, още топъл. Около него тревата е опърлена.', likes: [Biome.Tundra, Biome.Plains, Biome.Desert] },
  { id: 'eggs', name: 'гнездо с шарени яйца', text: 'Някой е изписал яйцата с червени и сини шарки и ги е скрил в гнездо. Великден е подранил с няколко хиляди години.', likes: [Biome.Grassland, Biome.Forest] },
  { id: 'goldegg', name: 'златно яйце', text: 'Яйце от чисто злато върху камък. Понякога се пропуква и отвътре блести.', likes: [Biome.Hills, Biome.Grassland] },
  { id: 'robot', name: 'ръждясал робот', text: 'Малък робот, обрасъл с мъх. Когато го погледнеш, очите му светват и ти маха.', likes: [Biome.Forest, Biome.Plains, Biome.Marsh] },
  { id: 'stag', name: 'призрачен елен', text: 'Бял светещ елен стои между дърветата и бавно се разпада на искри.', likes: [Biome.Forest, Biome.Taiga] },
  { id: 'dragon', name: 'спящ дракон', text: 'Мъничък зелен дракон спи върху купчинка жълтици. Едното му око се отваря.', likes: [Biome.Mountain, Biome.Hills] },
  { id: 'portal', name: 'портал в каменен кръг', text: 'Между древни камъни се върти синя светлина. Накъде води, не е записано никъде.', likes: [Biome.Hills, Biome.Taiga, Biome.Grassland] },
];

export interface SecretSpot { k: number; kind: number; x: number; y: number }

export function secretSpots(seed: number, w: number, h: number, biome: Uint8Array, river: Uint8Array): SecretSpot[] {
  const rng = new Rng((seed ^ 0x5ec2e7) >>> 0);
  const out: SecretSpot[] = [];
  const dry = (i: number) => !isWater(biome[i]) && river[i] < RIVER_WATER && biome[i] !== Biome.Snow;
  for (let k = 0; k < SECRET_COUNT; k++) {
    const kind = k % SECRET_KINDS.length;
    const likes = SECRET_KINDS[kind].likes;
    let spot: SecretSpot | null = null;
    for (let a = 0; a < 400 && !spot; a++) {
      const x = rng.int(3, w - 4), y = rng.int(3, h - 4);
      const i = y * w + x;
      if (!dry(i) || (a < 300 && !likes.includes(biome[i]))) continue;
      if (out.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 8)) continue;
      spot = { k, kind, x: x + rng.range(-0.3, 0.3), y: y + rng.range(-0.3, 0.3) };
    }
    if (spot) out.push(spot);
  }
  return out;
}

// Seeded random generator (sfc32). The state is saved with the world, so a restart continues the same story.
export class Rng {
  s: [number, number, number, number];

  constructor(seed: number | [number, number, number, number]) {
    if (Array.isArray(seed)) {
      this.s = [...seed] as [number, number, number, number];
    } else {
      this.s = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
      for (let i = 0; i < 15; i++) this.next();
    }
  }

  next(): number {
    // the state is updated in place (fork): the same numbers as before, without a new array for every draw,
    // which was the busiest line of the whole simulation
    const s = this.s;
    const a0 = s[0] >>> 0, b0 = s[1] >>> 0, c0 = s[2] >>> 0, d0 = s[3] >>> 0;
    const t = (((a0 + b0) | 0) + d0) | 0;
    s[3] = (d0 + 1) | 0;
    s[0] = b0 ^ (b0 >>> 9);
    s[1] = (c0 + (c0 << 3)) | 0;
    const c = (c0 << 21) | (c0 >>> 11);
    s[2] = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Approximately normal, mean 0, sd 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
}

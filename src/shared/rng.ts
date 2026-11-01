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
    let [a, b, c, d] = this.s;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.s = [a, b, c, d];
    return (t >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
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

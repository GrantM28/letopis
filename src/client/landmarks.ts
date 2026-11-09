// Buildings of the later ages, drawn by code (there are no sprite sheets for them yet):
// a castle, mills, a factory, a train, an observatory, a radio mast, a rocket, a dome on the Moon...
// Each is a small Container standing on (0, 0) like the sprites, about the size of a town house.

import { Container, Graphics } from 'pixi.js';

/** [discovery, landmark] in the order history found them: a town shows its newest few */
export const LANDMARKS: [string, string][] = [
  ['megaliths', 'stones'],
  ['iron', 'forge'],
  ['philosophy', 'academy'],
  ['aqueduct', 'aqueduct'],
  ['watermill', 'watermill'],
  ['castle', 'castle'],
  ['university', 'academy'],
  ['windmill', 'windmill'],
  ['lighthouse', 'lighthouse'],
  ['ocean_ships', 'ship'],
  ['telescope', 'observatory'],
  ['steam_engine', 'factory'],
  ['railway', 'train'],
  ['electricity', 'pylon'],
  ['radio', 'mast'],
  ['computer', 'office'],
  ['nuclear_power', 'cooling'],
  ['solar_power', 'solar'],
  ['wind_farms', 'turbines'],
  ['spaceflight', 'rocket'],
  ['moon_base', 'dome'],
  ['fusion', 'fusion'],
  ['vertical_farms', 'towerfarm'],
  ['space_elevator', 'elevator'],
  ['starship', 'starship'],
];

const OUT = 0x2a1d14; // the dark outline the painted sprites have
const line = { color: OUT, width: 0.8, alpha: 0.9 };

/** an isometric box standing on (0,0): a = half width, h = height; colours of the left face, right face and top */
function box(g: Graphics, a: number, h: number, left: number, right: number, top: number, dx = 0, dy = 0) {
  const b = -a / 2; // the front corner stays on the ground at y = 0
  const P = (x: number, y: number) => [x + dx, y + dy - b - a / 2];
  g.poly([...P(-a, 0), ...P(0, a / 2), ...P(0, a / 2 - h), ...P(-a, -h)]).fill(left).stroke(line);
  g.poly([...P(0, a / 2), ...P(a, 0), ...P(a, -h), ...P(0, a / 2 - h)]).fill(right).stroke(line);
  g.poly([...P(-a, -h), ...P(0, a / 2 - h), ...P(a, -h), ...P(0, -a / 2 - h)]).fill(top).stroke(line);
}
/** a pitched roof over a box of the same size */
function roof(g: Graphics, a: number, h: number, rise: number, left: number, right: number, dx = 0, dy = 0) {
  const P = (x: number, y: number) => [x + dx, y + dy];
  g.poly([...P(-a, -h), ...P(0, a / 2 - h), ...P(0, -h - rise + a / 4), ...P(-a / 2, -h - rise - a / 4 + a / 4)]).fill(left).stroke(line);
  g.poly([...P(0, a / 2 - h), ...P(a, -h), ...P(a / 2, -h - rise), ...P(0, -h - rise + a / 4)]).fill(right).stroke(line);
}
function windows(g: Graphics, x0: number, y0: number, cols: number, rows: number, dx: number, dy: number, slope: number, color: number) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = x0 + c * dx, y = y0 + r * dy + c * dx * slope;
    g.poly([x, y, x + 1.6, y + 1.6 * slope, x + 1.6, y + 1.6 * slope - 2.2, x, y - 2.2]).fill(color);
  }
}

export function makeLandmark(kind: string): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  switch (kind) {
    case 'stones': {
      // a ring of standing stones
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const x = Math.cos(a) * 11, y = Math.sin(a) * 5;
        g.rect(x - 1.6, y - 9, 3.2, 9).fill(k % 2 ? 0x9a948c : 0x8a847c).stroke(line);
      }
      g.rect(-6, -11, 12, 2.2).fill(0x8f8981).stroke(line);
      break;
    }
    case 'lighthouse': {
      g.poly([-4.5, 0, 4.5, 0, 3, -26, -3, -26]).fill(0xeee6d6).stroke(line);
      for (let i = 0; i < 3; i++) g.poly([-4.2 + i * 0.5, -6 - i * 8, 4.2 - i * 0.5, -6 - i * 8, 4 - i * 0.5, -9 - i * 8, -4 + i * 0.5, -9 - i * 8]).fill(0xc8392f);
      g.rect(-3.5, -31, 7, 5).fill(0x3d4555).stroke(line);
      g.circle(0, -28.5, 2.2).fill(0xfff1a8);
      g.circle(0, -28.5, 6).fill({ color: 0xfff1a8, alpha: 0.18 });
      g.poly([-4, -31, 0, -35, 4, -31]).fill(0xc8392f).stroke(line);
      break;
    }
    case 'forge': {
      box(g, 7, 7, 0x8a5a3c, 0x6e452c, 0x9b6b48);
      roof(g, 7, 7, 5, 0x5b4a3e, 0x46392f);
      g.rect(3, -20, 2.5, 8).fill(0x6b6058).stroke(line);
      g.circle(4.5, -22, 2).fill({ color: 0xbfb8b0, alpha: 0.6 });
      g.circle(-3, -2.5, 1.6).fill(0xffa040);
      break;
    }
    case 'academy': {
      box(g, 9, 9, 0xe6dccb, 0xc9bda8, 0xefe6d6);
      for (let i = 0; i < 4; i++) g.rect(-8 + i * 2.2, -9 + i * 1.1, 0.9, 7).fill(0xfffaf0);
      g.poly([-9, -9, 0, -4.5, 9, -9, 0, -19]).fill(0xb8603e).stroke(line);
      break;
    }
    case 'aqueduct': {
      for (let i = 0; i < 3; i++) {
        const x = -10 + i * 7, y = -i * 3.5;
        g.rect(x, y - 12, 6, 12).fill(0xd8c8a8).stroke(line);
        g.arc(x + 3, y, 2.2, Math.PI, 0).fill(0x3a2c22);
      }
      g.poly([-10, -12, 11, -22.5, 11, -24.5, -10, -14]).fill(0xc4b291).stroke(line);
      break;
    }
    case 'watermill': {
      box(g, 7, 9, 0x9a6b44, 0x7c5434, 0xa77a52);
      roof(g, 7, 9, 6, 0x6b3a2a, 0x552d20);
      g.circle(-8, -5, 5.5).stroke({ color: 0x4a3222, width: 1.6 });
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 4; g.moveTo(-8 - Math.cos(a) * 5, -5 - Math.sin(a) * 5).lineTo(-8 + Math.cos(a) * 5, -5 + Math.sin(a) * 5).stroke({ color: 0x4a3222, width: 0.9 }); }
      g.ellipse(-8, 1, 7, 2).fill({ color: 0x5aa0d0, alpha: 0.7 });
      break;
    }
    case 'castle': {
      box(g, 11, 12, 0xa9a39a, 0x8d877f, 0xbab4ab);
      box(g, 5, 22, 0xb3ada4, 0x968f86, 0xc4beb5, -6, -3);
      for (let i = 0; i < 4; i++) g.rect(-10.5 + i * 2.6, -26.5 - i * 0 + 0, 1.6, 2).fill(0x9c968d);
      g.moveTo(-6, -27).lineTo(-6, -35).stroke({ color: OUT, width: 0.8 });
      g.poly([-6, -35, -1, -33.5, -6, -32]).fill(0xc8392f);
      g.rect(1, -6, 3, 5).fill(0x3a2c22);
      break;
    }
    case 'windmill': {
      g.poly([-5, 0, 5, 0, 3.5, -18, -3.5, -18]).fill(0xeee4d0).stroke(line);
      g.poly([-4.5, -18, 4.5, -18, 0, -23]).fill(0x8a4a32).stroke(line);
      g.rect(-1.2, -6, 2.4, 6).fill(0x5a3a26);
      const hx = 0, hy = -18;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.4;
        const ex = hx + Math.cos(a) * 13, ey = hy + Math.sin(a) * 13;
        const nx = -Math.sin(a) * 1.8, ny = Math.cos(a) * 1.8;
        g.poly([hx, hy, ex, ey, ex + nx, ey + ny, hx + nx * 0.4, hy + ny * 0.4]).fill(0xf6efe0).stroke(line);
      }
      g.circle(hx, hy, 1.4).fill(0x4a3222);
      break;
    }
    case 'ship': {
      g.ellipse(0, 1, 14, 3).fill({ color: 0x4f8fc0, alpha: 0.6 });
      g.poly([-12, -4, 12, -4, 8, 1, -9, 1]).fill(0x6e4428).stroke(line);
      g.moveTo(-2, -4).lineTo(-2, -26).stroke({ color: OUT, width: 1 });
      g.moveTo(5, -4).lineTo(5, -20).stroke({ color: OUT, width: 1 });
      g.poly([-2, -25, 4, -21, 4, -12, -2, -9]).fill(0xf3ead6).stroke(line);
      g.poly([5, -19, 10, -16, 10, -9, 5, -7]).fill(0xf3ead6).stroke(line);
      g.poly([-2, -26, -6, -24.5, -2, -23]).fill(0xc8392f);
      break;
    }
    case 'observatory': {
      box(g, 7, 7, 0xd6cbb6, 0xb9ad97, 0xe2d8c5);
      g.arc(0, -10.5, 6.5, Math.PI, 0).fill(0xc9ced6).stroke(line);
      g.poly([0.5, -17, 2.5, -17, 2.5, -10.5, 0.5, -10.5]).fill(0x2b3346);
      g.moveTo(1.5, -14).lineTo(7, -20).stroke({ color: 0x6b6f78, width: 1.6 });
      break;
    }
    case 'factory': {
      box(g, 11, 9, 0xa84f38, 0x8a3f2c, 0xb85e45);
      for (let i = 0; i < 3; i++) g.poly([-11 + i * 7, -9 - i * 3.5 + 0, -4 + i * 7, -12.5 - i * 3.5, -4 + i * 7, -16 - i * 3.5]).fill(0x5b5d66).stroke(line);
      g.rect(5, -30, 3.5, 22).fill(0x8a3f2c).stroke(line);
      g.rect(5, -30, 3.5, 2).fill(0x3a3a3a);
      for (let i = 0; i < 4; i++) g.circle(7 + i * 2.5, -33 - i * 3, 2.2 + i * 0.7).fill({ color: 0xc9c4bc, alpha: 0.55 - i * 0.1 });
      windows(g, -10, -3, 4, 1, 2.4, 0, 0.5, 0xffd27a);
      break;
    }
    case 'train': {
      g.moveTo(-15, 2).lineTo(15, -1).stroke({ color: 0x5a5049, width: 1 });
      g.moveTo(-15, 4).lineTo(15, 1).stroke({ color: 0x5a5049, width: 1 });
      g.roundRect(-11, -8, 13, 7, 3).fill(0x2f3036).stroke(line);
      g.rect(2, -12, 7, 11).fill(0x8a2f2a).stroke(line);
      g.rect(-9, -13, 2.5, 5).fill(0x2f3036).stroke(line);
      g.circle(-8, -16, 2).fill({ color: 0xdedad2, alpha: 0.7 });
      g.circle(-5, -19, 2.6).fill({ color: 0xdedad2, alpha: 0.5 });
      for (const x of [-8, -3, 5]) g.circle(x, 0, 2).fill(0xb63a2c).stroke(line);
      g.rect(3.5, -10.5, 4, 3).fill(0xffd27a);
      break;
    }
    case 'pylon': {
      g.poly([-5, 0, 5, 0, 1.2, -26, -1.2, -26]).stroke({ color: 0x5f6670, width: 1 });
      for (let i = 1; i < 5; i++) { const y = -i * 5.5, w = 5 - i * 0.8; g.moveTo(-w, y).lineTo(w, y + 0.01).stroke({ color: 0x5f6670, width: 0.8 }); }
      g.moveTo(-7, -21).lineTo(7, -21).stroke({ color: 0x5f6670, width: 1 });
      g.moveTo(7, -21).quadraticCurveTo(16, -16, 22, -20).stroke({ color: 0x2b2b2b, width: 0.5 });
      break;
    }
    case 'mast': {
      g.poly([-4, 0, 4, 0, 0.8, -34, -0.8, -34]).stroke({ color: 0xc23b2f, width: 1 });
      for (let i = 1; i < 7; i++) g.moveTo(-4 + i * 0.5, -i * 5).lineTo(4 - i * 0.5, -i * 5).stroke({ color: i % 2 ? 0xf2f2f2 : 0xc23b2f, width: 1 });
      g.circle(0, -35, 1.4).fill(0xff4a3a);
      break;
    }
    case 'office': {
      box(g, 9, 26, 0x7d8da0, 0x627287, 0x94a3b5);
      windows(g, -8, -4, 3, 6, 2.6, -3.8, 0.5, 0xbfe4ff);
      windows(g, 1, 0, 3, 6, 2.6, -3.8, -0.5, 0x9fd0f5);
      g.moveTo(2, -31).lineTo(2, -37).stroke({ color: 0x4a4f58, width: 0.8 });
      break;
    }
    case 'solar': {
      for (let i = 0; i < 3; i++) {
        const x = -12 + i * 8, y = -i * 4 + 2;
        g.moveTo(x + 3, y).lineTo(x + 3, y - 4).stroke({ color: 0x55585e, width: 1 });
        g.poly([x, y - 4, x + 7, y - 7.5, x + 8, y - 11, x + 1, y - 7.5]).fill(0x2e5fa8).stroke(line);
        g.moveTo(x + 0.5, y - 5.8).lineTo(x + 7.5, y - 9.3).stroke({ color: 0x8fb7ec, width: 0.5 });
      }
      break;
    }
    case 'cooling': {
      // a cooling tower with a plume of steam
      g.poly([-10, 0, 10, 0, 6.5, -14, 8, -24, -8, -24, -6.5, -14]).fill(0xc9ccd2).stroke(line);
      g.ellipse(0, -24, 8, 2).fill(0x8d929b).stroke(line);
      for (let i = 0; i < 4; i++) g.circle(-2 + i * 2.5, -28 - i * 3.5, 3 + i * 0.8).fill({ color: 0xf2f2f2, alpha: 0.6 - i * 0.12 });
      break;
    }
    case 'turbines': {
      for (let k = 0; k < 2; k++) {
        const x = -6 + k * 12, y = k * -3;
        g.moveTo(x, y).lineTo(x, y - 24).stroke({ color: 0xe8ecf0, width: 1.4 });
        for (let b = 0; b < 3; b++) {
          const a = (b / 3) * Math.PI * 2 + 0.3 + k;
          g.moveTo(x, y - 24).lineTo(x + Math.cos(a) * 9, y - 24 + Math.sin(a) * 9).stroke({ color: 0xf6f8fa, width: 1.6 });
        }
        g.circle(x, y - 24, 1.2).fill(0xb0b6bf);
      }
      break;
    }
    case 'towerfarm': {
      box(g, 7, 30, 0x6d8fa8, 0x587a93, 0x88a9c1);
      for (let i = 0; i < 6; i++) {
        g.rect(-6.5, -5 - i * 4.6, 6, 2).fill(0x5aa65a);
        g.rect(0.5, -3 - i * 4.6, 6, 2).fill(0x4f9a52);
      }
      break;
    }
    case 'elevator': {
      // a cable to the sky with a climber on it
      g.rect(-6, -3, 12, 3).fill(0x6b6f78).stroke(line);
      g.moveTo(0, -3).lineTo(0, -60).stroke({ color: 0xdfe6ee, width: 1 });
      g.moveTo(0, -60).lineTo(0, -80).stroke({ color: 0xdfe6ee, width: 1, alpha: 0.4 });
      g.rect(-2.2, -36, 4.4, 5).fill(0xe0a84f).stroke(line);
      break;
    }
    case 'rocket': {
      g.rect(-9, -2, 18, 3).fill(0x6b6f78).stroke(line);
      g.moveTo(7, -2).lineTo(7, -30).stroke({ color: 0xc23b2f, width: 1.2 });
      g.roundRect(-3, -30, 6, 26, 2).fill(0xf2f2f2).stroke(line);
      g.poly([-3, -30, 0, -37, 3, -30]).fill(0xd2392c).stroke(line);
      g.poly([-3, -9, -6.5, -3, -3, -4]).fill(0xd2392c).stroke(line);
      g.poly([3, -9, 6.5, -3, 3, -4]).fill(0xd2392c).stroke(line);
      g.circle(0, -21, 1.4).fill(0x6fb3ff);
      break;
    }
    case 'dome': {
      g.ellipse(0, 0, 13, 4).fill(0xb9b4ad).stroke(line);
      g.arc(0, 0, 12, Math.PI, 0).fill({ color: 0x9fd8ff, alpha: 0.55 }).stroke({ color: 0xe8f6ff, width: 0.8 });
      g.moveTo(-12, 0).quadraticCurveTo(0, -6, 12, 0).stroke({ color: 0xe8f6ff, width: 0.5, alpha: 0.8 });
      g.moveTo(0, -12).lineTo(0, 0).stroke({ color: 0xe8f6ff, width: 0.5, alpha: 0.8 });
      g.circle(-4, -3, 2).fill(0x5aa65a);
      g.circle(3, -2.5, 2.4).fill(0x4f9a52);
      break;
    }
    case 'fusion': {
      box(g, 9, 8, 0xdfe3ea, 0xc3c9d3, 0xeef1f5);
      g.ellipse(0, -14, 8, 3.5).stroke({ color: 0x7ad0ff, width: 2.4 });
      g.circle(0, -14, 2.2).fill(0xfff1a8);
      g.circle(0, -14, 4).fill({ color: 0xfff1a8, alpha: 0.25 });
      break;
    }
    case 'starship': {
      g.rect(-11, -2, 22, 3).fill(0x6b6f78).stroke(line);
      g.roundRect(-4.5, -44, 9, 42, 4).fill(0xd8dde4).stroke(line);
      g.poly([-4.5, -44, 0, -52, 4.5, -44]).fill(0xb9c0ca).stroke(line);
      g.poly([-4.5, -12, -10, -2, -4.5, -5]).fill(0x8a929e).stroke(line);
      g.poly([4.5, -12, 10, -2, 4.5, -5]).fill(0x8a929e).stroke(line);
      for (let i = 0; i < 3; i++) g.circle(0, -36 + i * 6, 1.2).fill(0x6fb3ff);
      break;
    }
  }
  return c;
}

// The "pixel look": the map is drawn on a coarse grid of big square pixels and every colour is pulled towards
// a small warm palette, for a cozy 8-bit feel. One filter over the map (the labels stay sharp above it).
// The grid is locked to the world, so the pixels do not shimmer while the camera moves.

import { Filter, GlProgram } from 'pixi.js';

/** an original warm 32-colour palette: earth, wood, meadow, water, stone, clay and cream */
export const PALETTE = [
  '1a1423', '2b1f2e', '3d2a35', '4f3a3a', '6b4a3a', '8a5d3b', 'a8743f', 'c99a5b', 'e3c48c', 'f4e3b5', 'fbf5e6',
  '2f4a2b', '3f6a35', '5a8c3a', '7fad46', 'a7cf5c', 'd3e48a',
  '1f3557', '2c5a83', '3f80a8', '69aec9', 'a5dbe0',
  '5c5a66', '827f8c', 'aaa7b0', 'd6d3d6',
  '8e3b3b', 'c25b4b', 'e08a5f', 'f2b36e', 'f7d46a',
  '5b3e6b',
];

// written for the oldest shader dialect WebGL offers (no arrays, no derivatives), so it runs everywhere
const VERT = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreen;
out vec2 vStep;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  vScreen = position;
  // texture coordinates per screen pixel
  vStep = uInputSize.zw;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const rgb = (h: string) => [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)).join(', ');

const FRAG = `
in vec2 vTextureCoord;
in vec2 vScreen;
in vec2 vStep;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uPix; // pixel size, grid offset x, grid offset y (screen pixels), palette strength
#define PAL(r, g, b) { vec3 q = vec3(r, g, b); vec3 e = (col - q) * W; float dd = dot(e, e); if (dd < bd) { bd = dd; best = q; } }
void main(void) {
  // the middle of this pixel's big square on the screen, back in texture space
  vec2 cell = floor((vScreen - uPix.yz) / uPix.x) * uPix.x + uPix.yz + uPix.x * 0.5;
  vec4 c = texture(uTexture, vTextureCoord + (cell - vScreen) * vStep);
  if (c.a < 0.02) { finalColor = vec4(0.0); return; }
  vec3 col = clamp((c.rgb / c.a - 0.5) * 1.06 + 0.52, 0.0, 1.0);
  // the nearest colour of the palette, weighted the way eyes see
  vec3 W = vec3(0.55, 0.85, 0.35);
  vec3 best = col;
  float bd = 1e9;
${PALETTE.map((h) => `  PAL(${rgb(h)})`).join(String.fromCharCode(10))}
  // crisp edges: a pixel is either there or not
  float a = c.a > 0.5 ? 1.0 : c.a * 0.6;
  finalColor = vec4(mix(col, best, uPix.w) * a, a);
}
`;

export function makePixelFilter(): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: VERT, fragment: FRAG, name: 'letopis-pixel' }),
    resources: {
      pixelUniforms: {
        uPix: { value: new Float32Array([3, 0, 0, 0.85]), type: 'vec4<f32>' },
      },
    },
  });
}

/** keep the grid on the world: call every frame with the world's screen position */
export function updatePixelFilter(f: Filter, worldX: number, worldY: number, size = 3, strength = 0.85) {
  const ox = ((worldX % size) + size) % size;
  const oy = ((worldY % size) + size) % size;
  const u = f.resources.pixelUniforms.uniforms;
  u.uPix = new Float32Array([size, ox, oy, strength]);
}


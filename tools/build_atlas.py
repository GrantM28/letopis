#!/usr/bin/env python3
"""Pack the cut sprites from art/cut into public/sprites/atlas.png + atlas.json.

Usage: python3 -I tools/build_atlas.py   (after tools/slice_sprites.py)

Every frame in atlas.json: x, y, w, h (pixels in the atlas), ax, ay (anchor 0..1),
s (world units per atlas pixel). Frames ending in "_c" hold only the cloth of a sprite,
in grey, so the game can tint it with the colour of the band.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUT = os.path.join(ROOT, 'art', 'cut')
OUT = os.path.join(ROOT, 'public', 'sprites')
ATLAS = 2048
PAD = 4

TW = 32  # tile width in world units (same as src/client/render.ts)

# name prefix -> (cut ids, kind, world width, texture width)
GROUPS: list[tuple[str, list[str], str, float, int]] = []


def group(prefix: str, ids: str, kind: str, world: float, tex: int):
    GROUPS.append((prefix, ids.split(), kind, world, tex))


# ground tiles (kind 'tile': anchor on the left/right corner of the diamond)
group('grass', 'A11 A12 A13 A14', 'tile', TW + 3, 128)
group('meadow', 'A21 A22 A23 A24', 'tile', TW + 3, 128)
group('steppe', 'A31 A32 A33 A34', 'tile', TW + 3, 128)
group('hill', 'A41 A42 A43 A44', 'tile', TW + 3, 128)
group('sand', 'B11 B12 B13 B14', 'tile', TW + 3, 128)
group('path', 'B21 B24', 'tile', TW + 3, 128)
group('wheat', 'B31 B32 B33 B34', 'tile', TW + 3, 128)
group('soil', 'B41 B42 B43 B44', 'tile', TW + 3, 128)
group('shallow', 'C11 C12 C13 C14', 'tile', TW + 3, 128)
group('deep', 'C21 C22 C23 C24', 'tile', TW + 3, 128)
group('lily', 'C31 C32 C33 C34', 'tile', TW + 3, 128)
group('marsh', 'C41 C42 C43 C44', 'tile', TW + 3, 128)
group('rock', 'D11 D12 D13 D14', 'tile', TW + 3, 128)
group('snow', 'D21 D22 D23 D24', 'tile', TW + 3, 128)
group('tundra', 'D31 D32 D33 D34', 'tile', TW + 3, 128)
group('crag', 'D41 D42 D43 D44', 'tile', TW + 3, 128)
# trees (kind 'prop': anchor in the middle of the grass patch at the foot)
group('oak', 'E11 E12 E14', 'prop', 26, 120)
group('blossom', 'E13', 'prop', 26, 120)
group('spruce', 'E21 E22', 'prop', 21, 96)
group('pine', 'E23 E24', 'prop', 24, 112)
group('birch', 'E31 E32', 'prop', 22, 104)
group('sapling', 'E33', 'prop', 18, 72)
group('apple', 'E34', 'prop', 22, 104)
group('spruce_snow', 'E41', 'prop', 21, 96)
group('bare_snow', 'E42', 'prop', 24, 112)
group('autumn', 'E43', 'prop', 24, 112)
group('bare', 'E44', 'prop', 24, 112)
# small nature
group('bush', 'F11 F12', 'prop', 15, 64)
group('berries', 'F13', 'prop', 15, 64)
group('flowerbush', 'F14', 'prop', 15, 64)
group('boulder', 'F21 F22 F23 F24', 'prop', 14, 64)
group('log', 'F31', 'prop', 14, 64)
group('stump', 'F32', 'prop', 12, 56)
group('mushroom', 'F33', 'prop', 9, 40)
group('reeds', 'F34', 'prop', 12, 56)
group('flowers', 'F41', 'prop', 11, 48)
group('tuft', 'F42', 'prop', 11, 48)
group('stones', 'F43', 'prop', 11, 48)
group('fern', 'F44', 'prop', 12, 56)
# stone age camp
group('hearth', 'G11 G12 G13 G14', 'prop', 17, 80)
group('tent', 'G21 G22', 'prop', 20, 88)
group('leanto', 'G23', 'prop', 20, 88)
group('bonehut', 'G24', 'prop', 21, 88)
group('furbed', 'G31', 'prop', 15, 64)
group('hiderack', 'G32', 'prop', 18, 80)
group('logpile', 'G33', 'prop', 13, 56)
group('embers', 'G34', 'prop', 17, 80)
group('totem', 'G41', 'prop', 6, 32)
group('banner', 'G42', 'cloth', 11, 56)
group('flag', 'G43', 'cloth', 12, 56)
group('cairn', 'G44', 'prop', 11, 48)
# neolithic village
group('roundhut', 'H11', 'prop', 21, 96)
group('house', 'H12', 'prop', 25, 112)
group('longhouse', 'H13', 'prop', 31, 128)
group('granary', 'H14', 'prop', 17, 72)
group('pen', 'H21', 'prop', 25, 112)
group('kiln', 'H22', 'prop', 15, 64)
group('well', 'H23', 'prop', 15, 64)
group('fence', 'H24', 'prop', 16, 64)
group('pots', 'H31', 'prop', 11, 48)
group('quern', 'H32', 'prop', 11, 48)
group('basket', 'H33', 'prop', 8, 40)
group('fishtrap', 'H34', 'prop', 12, 56)
group('canoe', 'H41', 'prop', 18, 80)
group('haystack', 'H42', 'prop', 13, 56)
group('sled', 'H43', 'prop', 15, 64)
group('shrine', 'H44', 'prop', 15, 64)
# people (world size is the height for these)
group('man', 'I11', 'person', 11, 64)
group('woman', 'I12', 'person', 11, 64)
group('elder', 'I13', 'person', 11, 64)
group('wave', 'I14', 'person', 11, 64)
group('gatherer', 'I21', 'person', 11, 64)
group('carrier', 'I22', 'person', 11, 64)
group('hunter', 'I23', 'person', 11, 64)
group('potter', 'I24', 'person', 11, 64)
group('walk', 'I31 I32 I33 I34', 'person', 11, 64)
# women and grandmothers (sheet K)
group('oldwoman', 'K11', 'person', 10.5, 64)
group('oldherbs', 'K12', 'person', 10.5, 64)
group('oldscarf', 'K13', 'person', 10.5, 64)
group('oldbasket', 'K14', 'person', 10.5, 64)
group('woman2', 'K21', 'person', 11, 64)
group('waterjar', 'K22', 'person', 11, 64)
group('spinner', 'K23', 'person', 11, 64)
group('reedcarrier', 'K24', 'person', 11, 64)
group('oldwalk', 'K31 K32 K33 K34', 'person', 10.5, 64)
group('womanwalk', 'K41 K42 K43 K44', 'person', 11, 64)
# children (sheet L): drawn smaller, the game scales them a bit more by age
group('boy', 'L11', 'person', 8, 56)
group('girl', 'L12', 'person', 8, 56)
group('kidtoy', 'L13', 'person', 8, 56)
group('kidwave', 'L14', 'person', 8, 56)
group('kidstick', 'L21', 'person', 8, 56)
group('kidberries', 'L22', 'person', 8, 56)
group('kidfish', 'L23', 'person', 8, 56)
group('kidpuppy', 'L24', 'person', 8, 56)
group('boywalk', 'L31 L32 L33 L34', 'person', 8, 56)
group('girlwalk', 'L41 L42 L43 L44', 'person', 8, 56)
# animals (kind 'animal': world size is the width, anchor at the hooves); frame 0 stands, 1 walks
group('mammoth', 'M11 M12', 'animal', 24, 120)
group('rhino', 'M13 M14', 'animal', 20, 104)
group('cavebear', 'M21 M22', 'animal', 16, 88)
group('megaloceros', 'M23 M24', 'animal', 18, 96)
group('aurochs', 'M31 M32', 'animal', 18, 96)
group('bison', 'M33 M34', 'animal', 18, 96)
group('wildhorse', 'M41 M42', 'animal', 14, 80)
group('reindeer', 'M43 M44', 'animal', 14, 80)
group('reddeer', 'N11 N12', 'animal', 14, 80)
group('boar', 'N13 N14', 'animal', 12, 72)
group('wolf', 'N21 N22', 'animal', 11, 64)
group('bear', 'N23 N24', 'animal', 15, 88)
group('fox', 'N31 N32', 'animal', 9, 56)
group('lynx', 'N33 N34', 'animal', 9, 56)
group('hare', 'N41 N42', 'animal', 6, 40)
group('beaver', 'N43 N44', 'animal', 7, 48)
# birds and water: eagle, owl and crow have two flight frames; duck, swan and fish sit on the water
group('eagle', 'O11 O12', 'animal', 12, 72)
group('stork', 'O13 O14', 'animal', 7, 48)
group('heron', 'O21 O22', 'animal', 7, 48)
group('duck', 'O23 O24', 'animal', 6, 40)
group('swan', 'O31 O32', 'animal', 8, 48)
group('owl', 'O33', 'animal', 5, 32)
group('owlfly', 'O34', 'animal', 9, 56)
group('crow', 'O41', 'animal', 5, 32)
group('crowfly', 'O42', 'animal', 8, 48)
group('fish', 'O43 O44', 'animal', 7, 48)
# farm animals
group('dog', 'P11 P12', 'animal', 8, 48)
group('goat', 'P13 P14', 'animal', 8, 48)
group('sheep', 'P21 P22', 'animal', 8, 48)
group('cow', 'P23 P24', 'animal', 13, 72)
group('pig', 'P31 P32', 'animal', 9, 56)
group('horse', 'P33 P34', 'animal', 13, 72)
group('hen', 'P41 P42', 'animal', 4, 32)
group('donkey', 'P43 P44', 'animal', 10, 56)
# south and desert
group('lion', 'Q11 Q12', 'animal', 13, 72)
group('camel', 'Q13 Q14', 'animal', 15, 80)
group('elephant', 'Q21 Q22', 'animal', 22, 112)
group('gazelle', 'Q23 Q24', 'animal', 9, 56)
group('ostrich', 'Q31 Q32', 'animal', 9, 56)
group('croc', 'Q33 Q34', 'animal', 14, 80)
group('monkey', 'Q41 Q42', 'animal', 6, 40)
group('cat', 'Q43 Q44', 'animal', 5, 32)
# secrets (easter eggs): drawn tiny on purpose (10% bigger since ver. 1.06), frame 0 and 1 alternate
group('sec_ufo', 'R11 R12', 'prop', 6.6, 48)
group('sec_meteor', 'R13 R14', 'prop', 6.6, 48)
group('sec_eggs', 'R21 R22', 'prop', 5.5, 40)
group('sec_goldegg', 'R23 R24', 'prop', 5.5, 40)
group('sec_robot', 'R31 R32', 'prop', 5.5, 40)
group('sec_stag', 'R33 R34', 'prop', 6.6, 48)
group('sec_dragon', 'R41 R42', 'prop', 6.6, 48)
group('sec_portal', 'R43 R44', 'prop', 6.6, 48)
# chiefs (sheets S-V, 8 frames each): A young/old, B young/old; their cream fur is kept as drawn (no band tint)
for look, young, old in (('chiefA', 'S', 'T'), ('chiefB', 'U', 'V')):
    for age, sheet in (('y', young), ('o', old)):
        group(f'{look}_{age}_idle', ' '.join(f'{sheet}{r}{c}' for r in (1, 2) for c in (1, 2, 3, 4)), 'person', 11.5, 64)
        group(f'{look}_{age}_walk', ' '.join(f'{sheet}{r}{c}' for r in (3, 4) for c in (1, 2, 3, 4)), 'person', 11.5, 64)
# growing trees (sheets W-Z): columns are kinds, rows are stages 1-4 (sapling, young, grown, big).
# Kind 'grow' keeps the sizes of the sheet: world units per source pixel instead of a fixed width.
GROW_WPP = 0.1   # world units per sheet pixel: the big oak is about 27 wide, like the old trees
GROW_TEX = 4.6   # texture pixels per world unit (same sharpness as the other trees)
GROW_BOOST = {'Y4': 1.22}  # the conifer sheet drew its last row no bigger than the third
for sheet, kinds in (('W', 'spruceS bareS autumn bare'), ('X', 'birch birchY fruit apple'),
                     ('Y', 'spruceL spruceD pine pineU'), ('Z', 'oak oakL blossom oakOld')):
    for c, kind in enumerate(kinds.split(), start=1):
        group(f'g_{kind}', ' '.join(f'{sheet}{r}{c}' for r in (1, 2, 3, 4)), 'grow', GROW_WPP, 0)
# sheets AA-AF (world units per sheet pixel; 'pose' = people, 'thing' = objects)
def cells(sheet, rows):
    return ' '.join(f'{sheet}{r}{c}' for r in rows for c in (1, 2, 3, 4))
PEOPLE_WPP = 0.0525  # a standing adult in these sheets is about 220 px = 11.5 world units
for k, kind in enumerate(('oak', 'birch', 'pine', 'old'), start=1):
    group(f'stump_{kind}', f'AA1{k} AA2{k}', 'thing', 0.037, 0)  # 0 old, 1 fresh
group('felled', 'AA31', 'thing', 0.045, 0)
group('birchlog', 'AA32', 'thing', 0.04, 0)
group('logs3', 'AA33', 'thing', 0.04, 0)
group('woodstack', 'AA34', 'thing', 0.045, 0)
group('branches', 'AA41', 'thing', 0.035, 0)
group('chopblock', 'AA42', 'thing', 0.035, 0)
group('brushwood', 'AA43', 'thing', 0.035, 0)
group('staked', 'AA44', 'thing', 0.035, 0)
group('chop', cells('AB', (1, 2)), 'pose', PEOPLE_WPP, 0)
group('carry', cells('AB', (3, 4)), 'pose', PEOPLE_WPP, 0)
group('sleepM', 'AC11 AC12', 'pose', PEOPLE_WPP, 0)
group('sleepF', 'AC13 AC14', 'pose', PEOPLE_WPP, 0)
group('sleepK', 'AC21 AC22', 'pose', PEOPLE_WPP, 0)
group('sleepKK', 'AC23 AC24', 'pose', PEOPLE_WPP, 0)
group('sitM', 'AC31 AC32', 'pose', PEOPLE_WPP, 0)
group('sitF', 'AC33 AC34', 'pose', PEOPLE_WPP, 0)
group('guard', 'AC41 AC42 AC43 AC44', 'pose', PEOPLE_WPP, 0)
group('tell', cells('AD', (1, 2)), 'pose', PEOPLE_WPP, 0)
group('listen', cells('AD', (3, 4)), 'pose', PEOPLE_WPP, 0)
group('throw', cells('AE', (1,)), 'pose', PEOPLE_WPP, 0)
group('pick', cells('AE', (2,)), 'pose', PEOPLE_WPP, 0)
group('spearfish', cells('AE', (3,)), 'pose', PEOPLE_WPP, 0)
group('knap', cells('AE', (4,)), 'pose', PEOPLE_WPP, 0)
group('hutb', cells('AF', (1,)), 'thing', 0.07, 0)    # 0..3: stakes, wattle, roof frame, done
group('houseb', cells('AF', (2,)), 'thing', 0.075, 0)  # 0..3: first bricks, walls, beams, done
group('field', cells('AF', (3,)), 'tile', TW + 3, 128)  # 0..3: ploughed, sprouts, wheat, stubble
group('goatpen', 'AF41', 'thing', 0.08, 0)
group('quern2', 'AF42', 'thing', 0.05, 0)
group('oven', 'AF43', 'thing', 0.055, 0)
group('bricks', 'AF44', 'thing', 0.06, 0)
# bronze age (AG props, AH town); skipped until the sheets exist
for cid, name, w in (('AG11', 'ore', 0.045), ('AG12', 'mine', 0.07), ('AG13', 'furnace', 0.055), ('AG14', 'mould', 0.045),
                     ('AG21', 'anvil', 0.045), ('AG22', 'toolrack', 0.05), ('AG23', 'potwheel', 0.045), ('AG24', 'loom', 0.05),
                     ('AG31', 'ploughox', 0.075), ('AG32', 'cart', 0.06), ('AG33', 'cartfull', 0.06), ('AG34', 'horsepost', 0.06),
                     ('AG41', 'sailboat', 0.07), ('AG42', 'tablets', 0.045), ('AG43', 'granary2', 0.06), ('AG44', 'stall', 0.06),
                     ('AH21', 'wall', 0.075), ('AH22', 'wallc', 0.075), ('AH23', 'gate', 0.085), ('AH24', 'tower', 0.075),
                     ('AH41', 'well2', 0.05), ('AH42', 'market', 0.08), ('AH43', 'road', 0.07), ('AH44', 'statue', 0.06)):
    group(name, cid, 'thing', w, 0)
group('townb', cells('AH', (1,)), 'thing', 0.08, 0)   # 0..3: foundation, walls, upper floor, done
group('templeb', cells('AH', (3,)), 'thing', 0.09, 0)  # 0..3: platform, steps, columns, done
group('trod', cells('AM', (1, 2, 3, 4)), 'tile', TW + 3, 128)  # trampled camp ground, 16 variants
# village guards (AN stone age, AO bronze age): the spear reaches above the head; the man is ~10% taller than the others
group('gwalk', cells('AN', (1, 2)), 'person', 13.6, 64)
group('gidle', cells('AN', (3, 4)), 'person', 13.6, 64)
group('bgwalk', cells('AO', (1, 2)), 'person', 13.6, 64)
group('bgidle', cells('AO', (3, 4)), 'person', 13.6, 64)
# sleepers that had no own sprites (AP): chiefs, old people, girls and boys
for cid, name in (('AP11 AP12', 'chiefA_y_sleep'), ('AP13 AP14', 'chiefA_o_sleep'), ('AP21 AP22', 'chiefB_y_sleep'), ('AP23 AP24', 'chiefB_o_sleep'),
                  ('AP31 AP32', 'sleepOldM'), ('AP33 AP34', 'sleepOldF'), ('AP41 AP42', 'sleepGirl'), ('AP43 AP44', 'sleepBoy')):
    group(name, cid, 'pose', PEOPLE_WPP * 0.8, 0)  # drawn a bit bigger than the AC sleepers
group('smith', cells('AI', (1,)), 'pose', PEOPLE_WPP, 0)
group('plougher', cells('AI', (2,)), 'pose', PEOPLE_WPP, 0)
group('wheelpot', cells('AI', (3,)), 'pose', PEOPLE_WPP, 0)
group('weaver', cells('AI', (4,)), 'pose', PEOPLE_WPP, 0)
group('trader', cells('AJ', (1,)), 'pose', PEOPLE_WPP, 0)
group('scribe', cells('AJ', (2,)), 'pose', PEOPLE_WPP, 0)
group('rider', cells('AJ', (3,)), 'pose', PEOPLE_WPP, 0)
group('sailer', cells('AJ', (4,)), 'pose', PEOPLE_WPP, 0)
# band symbols (white, tinted in game), same order as SYMBOLS in render.ts
group('sym', 'AQ101 AQ102 AQ103 AQ104 AQ105 AQ106 AQ107 AQ108 AQ109 AQ110 AQ201 AQ202 AQ203 AQ204 AQ205 AQ206 AQ207 AQ208 AQ209 AQ210 AQ301 AQ302 AQ303 AQ304 AQ305 AQ306 AQ307 AQ308 AQ309 AQ310 AQ401 AQ402 AQ403 AQ404 AQ405 AQ406 AQ407 AQ408 AQ409 AQ410 AQ501 AQ502 AQ503 AQ504 AQ505 AQ506 AQ507 AQ508 AQ509 AQ510 AR101 AR102 AR103 AR104 AR105 AR106 AR107 AR108 AR109 AR110 AR201 AR202 AR203 AR204 AR205 AR206 AR207 AR208 AR209 AR210 AR301 AR302 AR303 AR304 AR305 AR306 AR307 AR308 AR309 AR310 AR401 AR402 AR403 AR404 AR405 AR406 AR407 AR408 AR409 AR410 AR501 AR502 AR503 AR504 AR505 AR506 AR507 AR508 AR509 AR510', 'symbol', 6, 64)


def resize(img: Image.Image, w: int, h: int) -> Image.Image:
    return img.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')


def corner_y(a: np.ndarray) -> float:
    """Row of the left and right corners of an isometric tile (where it is widest)."""
    m = a[..., 3] > 0
    left = np.nonzero(m[:, :4].any(1))[0]
    right = np.nonzero(m[:, -4:].any(1))[0]
    return (left.min() + right.min()) / 2


def top_only(img: Image.Image, cy: float) -> Image.Image:
    """Only the top diamond of a tile, without the side wall: used where the tile in front is not lower,
    so no wall can peek out between neighbours and the ground looks seamless.
    The darker rim along the front edges is replaced by colours from inside the tile, so it does not
    show as a grid line under the uneven back edge of the next tile."""
    a = np.array(img).astype(np.float32)
    h, w = a.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    edge = cy + (w / 4) * (1 - np.abs(xs - w / 2) / (w / 2))
    inner = (ys < edge - 7) & (a[..., 3] > 200)
    # average colour of the nearby inside, by a masked blur
    rgbm = np.dstack([a[..., :3] * inner[..., None], inner * 255.0]).astype(np.uint8)
    blur = np.array(Image.fromarray(rgbm, 'RGBA').filter(ImageFilter.GaussianBlur(7))).astype(np.float32)
    mean = a[..., :3][inner].mean(0)
    k = np.clip(blur[..., 3:4] / 40, 0, 1)
    fill = (blur[..., :3] / np.maximum(blur[..., 3:4], 1) * 255) * k + mean * (1 - k)
    t = np.clip((ys - (edge - 9)) / 6, 0, 1)[..., None]  # 0 inside -> 1 at the edge
    band = (ys > edge - 9) & (xs >= 0)
    out = a.copy()
    out[..., :3] = np.where(band[..., None], a[..., :3] * (1 - t) + fill * t, a[..., :3])
    # soften the light rim along the back edges too, keeping the uneven outline of the grass
    top_edge = cy - (w / 4) * (1 - np.abs(xs - w / 2) / (w / 2))
    tb = (np.clip(1 - (ys - top_edge) / 8, 0, 1) * 0.65 * (ys > top_edge - 8))[..., None]
    out[..., :3] = out[..., :3] * (1 - tb) + fill * tb
    out[..., 3] = np.where(band, 255, a[..., 3])
    # cut below the front edges, keeping some overlap so no gap shows when zoomed out
    out[ys > edge + 6, 3] = 0
    out[ys < edge - 9, 3] = a[ys < edge - 9, 3]
    # stray wall pixels at the left/right corners
    out[(np.abs(xs - w / 2) > w / 2 - 7) & (ys < edge - 2), 3] = 0
    out[out[..., 3] == 0, :3] = 0
    return Image.fromarray(out.astype(np.uint8))


def split_cloth(img: Image.Image, head: float, bright: float = 0.45, satmax: float = 0.2) -> tuple[Image.Image, Image.Image]:
    """Light grey/white cloth -> separate grey layer; the rest stays in the base."""
    a = np.array(img).astype(np.float32)
    rgb = a[..., :3] / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    cloth = (sat < satmax) & (mx > bright) & (a[..., 3] > 0)
    cloth[: int(a.shape[0] * head)] = False
    base = a.copy()
    base[cloth, 3] = 0
    c = np.zeros_like(a)
    lum = rgb.mean(-1)
    # stretch so the brightest cloth is white: tint then gives the real band colour
    top = np.percentile(lum[cloth], 95) if cloth.any() else 1
    g = np.clip(lum / max(top, 1e-3), 0, 1) * 255
    c[..., 0] = c[..., 1] = c[..., 2] = g
    c[..., 3] = np.where(cloth, a[..., 3], 0)
    return Image.fromarray(base.astype(np.uint8)), Image.fromarray(c.astype(np.uint8))


def split_fur(img: Image.Image, head: float) -> tuple[Image.Image, Image.Image]:
    """Sheets AB-AE draw the clothes as cream fur: that fur -> a separate grey layer for the band colour."""
    a = np.array(img).astype(np.float32)
    rgb = a[..., :3] / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    d = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    # warm, pale, a little saturated: fur; white hair and beards (sat < 0.12) and skin (sat > 0.45) stay
    fur = (sat > 0.12) & (sat < 0.45) & (mx > 0.45) & (hue > 20) & (hue < 60) & (a[..., 3] > 0)
    fur[: int(a.shape[0] * head)] = False
    base = a.copy()
    base[fur, 3] = 0
    c = np.zeros_like(a)
    lum = rgb.mean(-1)
    top = np.percentile(lum[fur], 95) if fur.any() else 1
    gr = np.clip(lum / max(top, 1e-3), 0, 1) * 255
    c[..., 0] = c[..., 1] = c[..., 2] = gr
    c[..., 3] = np.where(fur, a[..., 3], 0)
    return Image.fromarray(base.astype(np.uint8)), Image.fromarray(c.astype(np.uint8))


# roads (sheets AK dirt, AL paved): only the road is kept, as an overlay on any ground.
# mask bits: 1 = -x (upper-left edge), 2 = -y (upper-right), 4 = +x (lower-right), 8 = +y (lower-left)
ROAD_SHEETS = (('AK', 1), ('AL', 2))
ROAD_CELLS = {5: '11', 10: '12', 15: '13', 4: '14', 6: '22', 9: '24', 14: '31', 13: '32', 8: '41', 1: '42', 2: '43'}
ROAD_ENDS = {1: '42', 2: '43', 4: '14', 8: '41'}


def road_overlay(img: Image.Image, cy: float) -> Image.Image:
    t = np.array(top_only(img, cy)).astype(np.float32)
    rgb = t[..., :3] / 255
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = np.maximum(mx - mn, 1e-6)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    grass = (hue > 62) & (hue < 170) & (sat > 0.2)
    road = (t[..., 3] > 200) & ~grass
    m = Image.fromarray((road * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))  # flowers and pebbles out
    m = m.filter(ImageFilter.GaussianBlur(0.8))
    out = t.copy()
    out[..., 3] = np.minimum(np.array(m).astype(np.float32), t[..., 3])
    out[out[..., 3] == 0, :3] = 0
    return Image.fromarray(out.astype(np.uint8))


def road_frames() -> list:
    items = []
    for sheet, lvl in ROAD_SHEETS:
        if not all(os.path.exists(os.path.join(CUT, f'{sheet}{c}.png')) for c in list(ROAD_CELLS.values()) + ['44']):
            continue
        over = {}
        geo = None
        for key, c in list(ROAD_CELLS.items()) + [('bridge', '44')]:
            src = Image.open(os.path.join(CUT, f'{sheet}{c}.png')).convert('RGBA')
            a = np.array(src)
            w0, h0 = src.size
            h = max(1, round(h0 * 128 / w0))
            img = resize(src, 128, h)
            ay = corner_y(a) / h0
            over[key] = (road_overlay(img, ay * h), ay)
            if geo is None:
                geo = (ay, (TW + 3) / 128, h)
        ay, s, h = geo
        for mask in range(1, 16):
            if mask in over:
                im, a_y = over[mask]
                items.append((f'road{lvl}_{mask}', im, 0.5, a_y, s))
                continue
            # no drawn tile for this shape: the dead ends of its edges meet in the middle
            im = Image.new('RGBA', (128, h), (0, 0, 0, 0))
            for bit in (1, 2, 4, 8):
                if mask & bit:
                    e = over[bit][0]
                    im.alpha_composite(e.crop((0, 0, 128, h)) if e.size[1] >= h else e, (0, 0))
            items.append((f'road{lvl}_{mask}', im, 0.5, ay, s))
        im, a_y = over['bridge']
        items.append((f'bridge{lvl}', im, 0.5, a_y, s))
    return items


def main() -> int:
    items = []  # (name, image, ax, ay, s)
    for prefix, ids, kind, world, tex in GROUPS:
        if not all(os.path.exists(os.path.join(CUT, f'{c}.png')) for c in ids):
            continue  # sheet not made yet
        for k, cid in enumerate(ids):
            name = prefix if len(ids) == 1 else f'{prefix}{k}'
            src = Image.open(os.path.join(CUT, f'{cid}.png')).convert('RGBA')
            a = np.array(src)
            w0, h0 = src.size
            if kind == 'person':
                h = tex
                w = max(1, round(w0 * h / h0))
                s = world / h
            elif kind in ('pose', 'thing'):
                # world units per sheet pixel: the sheet keeps its own sizes between cells
                ww = w0 * world
                w = max(1, round(ww * (5.6 if kind == 'pose' else 4.6)))
                h = max(1, round(h0 * w / w0))
                s = ww / w
            elif kind == 'grow':
                ww = w0 * world * GROW_BOOST.get(cid[:2], 1)
                w = max(1, round(ww * GROW_TEX))
                h = max(1, round(h0 * w / w0))
                s = ww / w
            else:
                w = tex
                h = max(1, round(h0 * w / w0))
                s = world / w
            if kind == 'tile':
                ay = corner_y(a) / h0
            elif kind == 'person':
                ay = 0.97
            elif kind == 'symbol':
                ay = 0.5
            elif kind == 'animal':
                ay = 0.96
            elif kind == 'pose':
                ay = 0.95
            else:
                # foot of a prop: the middle of its grass patch, about 8% of the width above the bottom
                ay = max(0.5, 1 - 0.08 * w0 / h0)
            if kind == 'symbol':
                a[..., :3] = 255  # black silhouettes -> white, tinted in game
                src = Image.fromarray(a)
            img = resize(src, w, h)
            if kind == 'tile':
                items.append((name, img, 0.5, ay, s))
                items.append((name + '_t', top_only(img, ay * h), 0.5, ay, s))
                continue
            if kind == 'pose' and cid[:2] in ('AB', 'AC', 'AD', 'AE'):
                # sleeping people lie down (no head on top); the storyteller's long beard reaches half way down
                head = 0 if cid[:3] in ('AC1', 'AC2') else 0.55 if cid[:2] == 'AD' else 0.3
                base, cloth = split_fur(img, head)
                items.append((name, base, 0.5, ay, s))
                items.append((name + '_c', cloth, 0.5, ay, s))
                continue
            if kind == 'pose' and cid[:2] in ('AI', 'AJ'):
                # bronze age linen: only the bright cloth is tinted (grey anvils and stones stay)
                head = {'AI3': 0.35, 'AJ2': 0.35, 'AJ4': 0.0}.get(cid[:3], 0.28)
                base, cloth = split_cloth(img, head, 0.66)
                items.append((name, base, 0.5, ay, s))
                items.append((name + '_c', cloth, 0.5, ay, s))
                continue
            if kind == 'person' and cid[:2] in ('AN', 'AO'):
                # guards: only the light tunic takes the clan colour, the grey wolf fur and the metal stay
                base, cloth = split_fur(img, 0.3) if cid[:2] == 'AN' else split_cloth(img, 0.3, 0.72, 0.3)
                items.append((name, base, 0.5, ay, s))
                items.append((name + '_c', cloth, 0.5, ay, s))
                continue
            if kind in ('person', 'cloth'):
                base, cloth = split_cloth(img, head=0.48 if cid == 'I13' else 1.0 if (cid[0] in 'STUV' and cid[1].isdigit()) else 0.3 if kind == 'person' else 0)
                items.append((name, base, 0.5, ay, s))
                items.append((name + '_c', cloth, 0.5, ay, s))
            else:
                items.append((name, img, 0.5, ay, s))

    items += road_frames()

    # shelf packing, tallest first; a new page (atlas1.png, ...) when one is full.
    # The first page keeps the sheets it always had, so the order of GROUPS decides what goes where.
    frames = {}
    pages = []
    os.makedirs(OUT, exist_ok=True)
    rest = items
    while rest:
        rest.sort(key=lambda it: -it[1].size[1])
        atlas = Image.new('RGBA', (ATLAS, ATLAS), (0, 0, 0, 0))
        x = y = PAD
        shelf = 0
        bottom = 0
        left = []
        for name, img, ax, ay, s in rest:
            w, h = img.size
            if x + w + PAD > ATLAS:
                x = PAD
                y += shelf + PAD
                shelf = 0
            if y + h + PAD > ATLAS:
                left.append((name, img, ax, ay, s))
                continue
            atlas.paste(img, (x, y))
            frames[name] = {'x': x, 'y': y, 'w': w, 'h': h, 'ax': ax, 'ay': round(ay, 4), 's': round(s, 5), 'p': len(pages)}
            x += w + PAD
            shelf = max(shelf, h)
            bottom = max(bottom, y + h)
        used = bottom + PAD
        # keep the height a power of two so mipmaps work everywhere
        height = 1
        while height < used:
            height *= 2
        fname = 'atlas.png' if not pages else f'atlas{len(pages)}.png'
        atlas.crop((0, 0, ATLAS, height)).save(os.path.join(OUT, fname), optimize=True)
        pages.append({'file': fname, 'size': [ATLAS, height]})
        print(f'page {fname}: {len(rest) - len(left)} frames, used {used} rows')
        if len(left) == len(rest):
            print('a sprite does not fit on an empty page', file=sys.stderr)
            return 1
        rest = left
    with open(os.path.join(OUT, 'atlas.json'), 'w', encoding='utf-8') as f:
        json.dump({'size': pages[0]['size'], 'pages': pages, 'frames': dict(sorted(frames.items()))}, f, separators=(',', ':'))
    print(f'{len(frames)} frames on {len(pages)} pages')
    return 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""Cut the 4x4 AI sprite sheets in art/sheets into single cleaned sprites in art/cut.

Usage: python3 -I tools/slice_sprites.py
Needs Pillow and numpy. Output is committed, so the game build does not need Python.
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = os.path.join(ROOT, 'art', 'sheets')
OUT = os.path.join(ROOT, 'art', 'cut')

ALPHA_CUT = 128   # below this a pixel is background
ERODE = 3         # px eaten from the outline: removes the coloured halo the generator leaves
MIN_PART = 0.04
# sheets that are not 4x4: letter -> (rows, columns); their cells are named <letter><row><column, two digits>
GRIDS = {'AQ': (5, 10), 'AR': (5, 10)}   # parts smaller than this share of the biggest part are specks and are dropped


def find_cuts(mask: np.ndarray, axis: int, n: int = 4, search: int = 60) -> list[int]:
    """Cut lines between rows/columns: the emptiest line near each nominal boundary."""
    size = mask.shape[axis]
    cover = mask.sum(axis=1 - axis)
    cuts = [0]
    for k in range(1, n):
        nominal = round(size * k / n)
        lo, hi = max(1, nominal - search), min(size - 1, nominal + search)
        window = cover[lo:hi]
        best = np.flatnonzero(window == window.min())
        # among the emptiest lines take the one closest to the nominal cut
        cuts.append(int(lo + best[np.argmin(np.abs(best + lo - nominal))]))
    cuts.append(size)
    return cuts


def erode(mask: np.ndarray, r: int) -> np.ndarray:
    m = mask.copy()
    for _ in range(r):
        n = m.copy()
        n[1:, :] &= m[:-1, :]
        n[:-1, :] &= m[1:, :]
        n[:, 1:] &= m[:, :-1]
        n[:, :-1] &= m[:, 1:]
        m = n
    return m


def components(mask: np.ndarray) -> tuple[np.ndarray, list[int]]:
    h, w = mask.shape
    lab = np.zeros((h, w), dtype=np.int32)
    sizes = [0]
    cur = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        cur += 1
        lab[y0, x0] = cur
        q = deque([(y0, x0)])
        count = 0
        while q:
            y, x = q.popleft()
            count += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = cur
                        q.append((yy, xx))
        sizes.append(count)
    return lab, sizes


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    return ~erode(~mask, r)


def clean_cell(rgba: np.ndarray, symbol: bool = False) -> np.ndarray | None:
    mask = rgba[..., 3] >= ALPHA_CUT
    if symbol:
        # thin stamped symbols: no eroding (it eats spears, legs and stars); close the speckles inside instead
        mask = erode(dilate(mask, 2), 2) & (rgba[..., 3] > 0) | mask
        mask = erode(dilate(mask, 2), 2)
    else:
        mask = erode(mask, ERODE)
    if not mask.any():
        return None
    lab, sizes = components(mask)
    biggest = max(sizes[1:])
    keep = np.zeros_like(mask)
    for i, s in enumerate(sizes):
        if i and s >= biggest * (0.004 if symbol else MIN_PART):
            keep |= lab == i
    ys, xs = np.nonzero(keep)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = rgba[y0:y1, x0:x1].copy()
    out[..., 3] = np.where(keep[y0:y1, x0:x1], 255, 0)
    out[out[..., 3] == 0, :3] = 0
    return out


def key_magenta(img: np.ndarray) -> np.ndarray:
    """Sheets made on a solid #FF00FF background (no real transparency): magenta -> transparent."""
    rgb = img[..., :3].astype(np.int32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    magenta = (r - g > 90) & (b - g > 90) & (np.abs(r - b) < 90)
    out = img.copy()
    out[..., 3] = np.where(magenta, 0, 255)
    # pull the pink spill out of the edges
    spill = np.minimum(r, b) - g
    edge = ~magenta & (spill > 30)
    out[edge, 0] = np.clip(r[edge] - spill[edge] // 2, 0, 255)
    out[edge, 2] = np.clip(b[edge] - spill[edge] // 2, 0, 255)
    return out


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    for name in sorted(os.listdir(SHEETS)):
        if not name.endswith('.png'):
            continue
        letter = name.split('-')[0]  # 'A-grass.png' -> A, 'AB-stumps.png' -> AB
        img = np.array(Image.open(os.path.join(SHEETS, name)).convert('RGBA'))
        if img[..., 3].min() == 255:
            img = key_magenta(img)
        mask = img[..., 3] >= ALPHA_CUT
        nr, nc = GRIDS.get(letter, (4, 4))
        rows = find_cuts(mask, 0, nr, search=40 if nr > 4 else 60)
        cols = find_cuts(mask, 1, nc, search=40 if nc > 4 else 60)
        for r in range(nr):
            for c in range(nc):
                cid = f'{letter}{r + 1}{c + 1:02}' if letter in GRIDS else f'{letter}{r + 1}{c + 1}'
                cell = img[rows[r]:rows[r + 1], cols[c]:cols[c + 1]]
                sprite = clean_cell(cell, symbol=letter in GRIDS)
                if sprite is None:
                    print(f'{cid}: empty', file=sys.stderr)
                    continue
                Image.fromarray(sprite).save(os.path.join(OUT, f'{cid}.png'))
        print(name, 'rows', rows, 'cols', cols)
    return 0


if __name__ == '__main__':
    sys.exit(main())

# Letopis 1.40 plan: steady, tested, ready for 2.0

Written 2026-11-09 after a round of measurements on the fork as of 1.37. The theme of 1.40 is **slow down and make it solid**:
no big new systems, but the tests, guard rails and clean-up that let 2.0 be built on firm ground.

## Where things stand (measured, not guessed)

| What | Finding | Source |
|---|---|---|
| Pacing of the ages | Stone → New Stone Age at ~7000 BC, Bronze ~3000 BC, Iron 1500–1000 BC, Middle Ages by AD 500, Early Modern by AD 1500, Information Age by AD 2000 | 14,000-year run (1.31 tech list) |
| Learning helps | Same worlds with learning switched off grow ~15% fewer people (1.34 rules) | 4 seeds × 1,200 years, with/without |
| Learning can find exploits | 1.33 brains put everyone on herding/fishing (no limit) and grew villages of 30,000; fixed in 1.34 with diminishing returns | local world, 6168 BC |
| Learning can hurt everyone | letting brains pick hunting over gathering made every clan over-hunt (tragedy of the commons); taken back in 1.34 | 3 seeds × 1,200 years |
| Brains saturate | average job weights sit near the 5.0 ceiling (herd 4.6, fish 4.9, craft 4.7): the networks push everything up and the *shares* hardly differ, so most clans read as "Jacks of all trades" | long runs at 7000–7500 BC |
| Save and reload | the world continues identically (people, births, discoveries, dice), but brain outputs drift in the 4th decimal because the original game rounds plants and game when it saves | save/load test, 300 + 200 years |
| Chronicle noise | camp moves are 44–64% of all entries, "changed their way of life" 11–12%: together more than half, crowding out the story | health tests, 3 worlds to 9000 BC |
| Survival | no world died out; ~2,200–2,800 people by 9000 BC, no clan above 44 people | health tests, 3 worlds |
| Speed | ~1.5 ms per month with a few hundred people, 6–12 ms with ~2,500; the dice were the hottest line (fixed in 1.36, −20%) | profile + health tests |
| Save size | 2.3–3.1 MB raw / ~0.6 MB compressed at ~2,500 people; brains are ~0.6 MB of it | health tests |
| Drift from the original | 27 files differ (+3,706 / −244 lines); 1,306 of those lines are in the original author's files, 785 in `src/client/main.ts` alone; 11 places reach into private parts of the simulation | `git diff upstream/main...main` |
| Upstream | no new commits since the fork, but the author was committing daily; any update will collide with `main.ts` | `git log main..upstream/*` |
| Tests | only `npm run check:english` runs on every build; everything else above was a one-off script | |

## Goals for 1.40

1. **Every important property is checked on every build**, not by hand: no crash, no runaway villages, no Bulgarian,
   a sound discovery tree, identical continuation after a save, the server answering its API.
2. **Guard rails** so a future exploit cannot run away again, whatever the brains discover.
3. **A calmer chronicle** where the story is not buried under camp moves.
4. **Brains that express real preferences** instead of all pushing to the ceiling.
5. **A fork that is easy to keep in step** with the original author: fork code out of the shared files.

Out of scope for 1.40 (candidates for 2.0): realms/states, a settings page, English-style names, new art.

## Work

### A. A test suite that runs on every build (first, everything else leans on it)

`npm test` runs all of these; the GitHub workflow runs `npm test` before building the image, and a failure stops the release.

| Test | Checks | Budget |
|---|---|---|
| `tests/techtree` | every requirement exists and comes earlier in history; every discovery has English, a description and a kids' line; ids unique | < 1 s |
| `tests/english` | (today's `check:english`) every deed, cause, discovery and chronicle line in English | ~1 min |
| `tests/smoke` | 3 fixed seeds × 600 years: no exception, population between 50 and 20,000, no clan above 3× its split limit, ≥ 10 discoveries | ~2 min |
| `tests/saveload` | 300 years, save, reload, 200 more: identical to never stopping, **including brains** | ~1 min |
| `tests/api` | start the server on a free port with a temp data folder; every endpoint answers JSON with the expected fields; POST /api/time and /api/act work; stop and clean up | ~30 s |
| `tests/determinism` | two runs of the same seed give the same world | ~30 s |

Not on every build (too slow), but as scripts with a written baseline:
`npm run experiment:learning` (with/without learning, 4 seeds × 1,200 years) and `npm run experiment:pacing` (one world to AD 2100,
reporting when each age begins). Both write a small report to `docs/experiments/`.

### B. Guard rails in the simulation

- **Crowding**: when a clan is above 2× its split limit and finds no land to split into, births in it slow down (and more so the
  further over); above 3× a part of the clan leaves for the best spot within reach even if it is poor. Today such a clan grows
  without end; the 30,000-person villages showed it.
- **Brain senses rounded to 2 decimals** before the network sees them, so a reloaded world decides exactly as it would have.
- **Brain outputs as shares**: the six job outputs go through a softmax (shares that add up to 1) times the number of jobs, instead of
  six independent exp() values that all saturate at 5. Re-run the with/without-learning experiment: learning must still win.
- **One adapter for the simulation's private parts**: `sim.host()` returns a typed object with exactly what events, relations and
  brains use, instead of 11 `as unknown as` casts. If the original author renames something, it breaks in one place, at compile time.

### C. A calmer chronicle

- Camp moves: written only when the move is far (≥ 6 tiles) or the reason is hunger or lack of wood, and at most once per clan per
  10 years; the rest still happen, silently. Target: moves under 15% of entries.
- "Changed their way of life": only when the new way lasts 3 years (not every flicker). Target: under 5%.
- A **"Hide everyday life"** chip in the chronicle (moves, marriages, ordinary deaths) next to the existing filters.

### D. Keeping in step with the original

- Move the fork's page code out of `src/client/main.ts` into its own modules: `help.ts` (powers and prayers), `people.ts`,
  `dashboard.ts` (stats), `discoveries.ts`, `clancard.ts` (clan card, brain drawing). `main.ts` keeps only small hooks.
  Target: the fork's diff in `main.ts` under 250 lines (from 785).
- Same for `public/style.css`: the fork's styles in `public/fork.css`, loaded after the original.
- A short `docs/FORK.md`: every hook in an upstream file, one line each, so a merge knows what to keep.

## How 1.40 is tested before release

1. `npm test` green locally and on GitHub.
2. The learning experiment still shows learning ahead (target ≥ +10% people) with the softmax outputs.
3. The pacing experiment: each age within ±40% of its target date (as now).
4. A fresh world run locally at 100× for an hour in the browser: no console errors, memory stays flat (no climb over 30 min).
5. The existing world on Unraid upgrades without a reset (old saves load; brains convert).
6. Watch the Unraid world for a day after the update: the chronicle mix, the largest clan, the container's memory.

## Order of work

1. A (tests) — so every later change is checked.
2. B (guard rails), with the experiment re-run.
3. C (chronicle).
4. D (clean-up), last, because it touches the most lines; the tests from A make it safe.
5. Release 1.40 with the checklist above; then plan 2.0.

## Risks

- Softmax outputs change how brains behave; if learning stops beating no-learning, keep the old outputs and only add the crowding guard.
- Moving code out of `main.ts` is a large diff; done in small commits with the page checked after each.
- Tests that simulate hundreds of years make the build slower (budget: under 6 minutes extra on GitHub).

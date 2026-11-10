# How this fork sits on top of the original

This is a fork of [leppermesiah/letopis](https://github.com/leppermesiah/letopis). To keep merging the original easy,
the fork's code lives in **its own files**, and the original's files carry only small hooks that call into them.
If a merge from the original conflicts, the conflict should be in one of the hooks listed here.

## The fork's own files

| Area | Files |
| --- | --- |
| Discoveries and ages | `src/shared/later_techs.ts`, `more_techs.ts`, `more_techs2.ts` (techs after the Bronze Age, era gates) |
| English words for the fork's events | `src/shared/event_words.ts` |
| World events, watchers' powers, prayers, camp-move news | `src/server/sim/events.ts` |
| Friendships and rivalries between clans | `src/server/sim/relations.ts` |
| The brains: Brain 2 (cultures sharing a deep network that learns from growth) and Brain 1 (one small network per clan, `LETOPIS_BRAIN=1`) | `src/server/sim/brain2.ts`, `src/server/sim/brain.ts` |
| Pasture: herds need grass shared with nearby herders (experiment, off unless `LETOPIS_PASTURE` is set) | `src/server/sim/pasture.ts` |
| The brain benchmark and long-run probes | `tools/bench.ts`, `tools/bench.mjs`, `tools/longrun.ts`, `tools/switch.ts`, `tools/pasture-probe.ts` |
| Extra API endpoints, history, settings | `src/server/extras.ts` |
| Phone / Home Assistant notifications | `src/server/notify.ts` |
| Daily backups of the world | `src/server/backups.ts` |
| The admin page (backups, roll back, new world, health) | `src/server/admin.ts`, `public/admin.html` |
| Page: shared helpers and the doorway into `main.ts` | `src/client/kit.ts` |
| Page: speed of time (pause, play, fast forward) | `src/client/clock.ts` |
| Page: ages and the progress bar under the clock | `src/client/ages.ts` |
| Page: Help the world (powers, prayers) | `src/client/help.ts` |
| Page: Stats tab and dashboard | `src/client/dashboard.ts`, `src/client/charts.ts` |
| Page: Discoveries tab and discovery cards | `src/client/discoveries.ts` |
| Page: People tab | `src/client/people.ts` |
| Page: clan card (help, brain, friends, people) | `src/client/clancard.ts`, `src/client/brainview.ts` |
| Page: minimap, landmarks | `src/client/minimap.ts`, `src/client/landmarks.ts` |
| Page: cultures on the map (the Cultures button) | `src/client/cultures.ts`, `src/client/culturelayer.ts` |
| Styles | `public/fork.css` (loaded after `style.css`) |
| Tests | `tests/` (`npm test`; CI runs them before building the image) |
| Plans | `docs/PLAN-*.md` |

## Hooks in the original's files

**`src/server/sim/sim.ts`**
- `host()` returns a `ForkHost`: the one doorway `events.ts`, `relations.ts`, `brain.ts` and `extras.ts` use into the simulation.
  If the original renames something they need, it fails to compile there.
- `SimState` gains optional fields: `relations`, `relState`, `brains`, `inspired`, `prayers`, `moveNews`, `cultures`, `cultureSeq`. Old saves load without them.
- Each month: `brainStep`, `relationsStep`, `worldEvents`, `prayersStep`; jobs are steered by `steerJobs`, restless moves by `wantsToMove`, camp moves told by `announceMove`.
- Food: `laterFarming()` (later farming techs), diminishing returns for herding and fishing, spoilage reduced by canning/refrigeration, medicine chain for longevity.
- Herding: `herdF` is multiplied by `pastureShare()` (1 unless the pasture experiment is on).
- `bandViews()` adds each clan's `culture`.
- Clans split when crowded, and a desperate split at three times the limit (a guard against runaway clans).
- `watcherAct` / `answerPrayer` for the watchers' powers.

**`src/server/index.ts`**: the autosave every two minutes packs the world in the background (`saveInBackground`) and, once a day, keeps that save as a backup (`backups.make`, also at startup); `admin.handle` comes first in the request handler, and `replaceWorld` puts a rolled-back or new world in place (`worldGen` makes sure an older background save never lands); query numbers that are not numbers count as not given (a crash on `?limit=abc`), the time scale (`TIME_SCALES`, `setTimeScale`), throttled broadcasts at high speed, the slow-client guard, `Extras` and `notify` wiring, English logs.

**`src/server/sim/tech.ts`**: adds `LATER_TECHS` and `ERA_GATES` to the tech list.

**`src/shared/i18n.ts`**: `TECH_DESC`, English for the later techs, `eventDeedEn` for the fork's deeds.

**`src/shared/rng.ts`**: the dice update their state in place (same numbers, less garbage).

**`src/shared/types.ts`**: `scale` on the time message; `culture` on a clan.

**`src/client/render.ts`**: landmarks, crisp pixel-art sprite pages, `onBands` (called after every update of the clans).

**`src/client/lang.ts`**: English only.

**`src/client/main.ts`**: imports the modules above and calls them: `setUi(...)` and `initHelp()` once, `renderDiscoveries`,
`renderPeople`, `renderStats` from `renderSide()`, `fillBandCard(b)` from `showBand()`, `showTech` on a click,
`clockFromServer` and `updateAgeProgress` from `applyTime()`. Also the chronicle filters (Story hides everyday life),
the clans tab search, the minimap, "while you were away", tour and night toggles.

**`public/index.html`**: the clock buttons, the Help button, the extra tabs, `fork.css`.

**`build.mjs`**: cache-busting for `fork.css`.

**`tools/`**: the sprite slicer and atlas builder handle the pixel-art sheets (CI rebuilds the atlas when `art/` changes).

## Merging the original

```bash
git fetch upstream
git merge upstream/main
npm run build && npm test
```

If the tests pass and the page opens, push. Never push to `upstream`.

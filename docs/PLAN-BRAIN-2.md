# Plan: Brain 2, a deep learning brain for the clans

Status: **being built** on the `brain2` branch. Target release: **1.50**.

The goal is a much deeper machine-learning brain that is the heart of the game, **without** making clans
superhuman: no early ages, no discoveries out of order. Learning should show in *how* clans live (when they
settle, where they camp, how they share food and work, how they survive a bad winter), not in skipping history.
Everything runs on the server. No external AI service, ever.

## Where Brain 1 stands (1.40)

- One small network per clan: 11 senses → 8 neurons → 9 outputs (177 weights).
- Learns by a (1+1) evolution strategy: every two years it tries one changed network and keeps it if the clan ate
  better and grew. Also copies better neighbours and passes its network to daughter clans.
- Measured: learning worlds grow 10-15% more people than frozen ones.
- Limits:
  - **Too little signal.** One clan judges one try with one noisy number every two years. Most of what is "kept" is luck.
  - **No memory.** It sees only this month. It cannot learn "the last two winters were bad, store more".
  - **Few decisions.** Only job shares, generosity and when to move. Not where to go, when to split, whom to trust.
  - **Clans forget.** When a clan dies out its lessons die with it, even if its neighbours found the same thing.

## The idea: cultures that learn together

Clans descended from the same first clan form a **culture** (a family tree of clans). A culture shares one deep
network. Each clan in it lives with a slightly different version of that network (its own noise), and every few
years the culture compares how its clans did and moves the shared network toward the versions that did best.

This is the evolution strategy used by OpenAI for robot control (Salimans et al., 2017): many noisy copies, judged
together, give a real direction to move in, not just "keep or throw away". With 20 clans in a culture, one learning
step uses 20 tries instead of 1. It needs no gradients, works with any simulation, and is fully deterministic from
the world's seed.

## The network

```
27 inputs  →  24 neurons  →  16 neurons  →  20 outputs        (~1,412 weights per culture)
(21 senses + 6 memory)        tanh            tanh
```

**Senses (21)**: season (2), hunger, food stores, fruit / game / fish / wood around, cold, clan size, children share,
elders share, settled, the age of the world, crowding (other clans near), friends near, rivals near, rivers or sea near,
months since last move, how the last trial went, sickness in the clan.

**Memory (6)**: six numbers the network writes each month and reads back the next (a small recurrent memory).
It decides on its own what to keep there: a running count of bad winters, a sense of a long drought, "we just moved".
Saved with the world.

**Outputs (20)**:

| Group | Outputs |
| --- | --- |
| Work | shares for farming, herding, fishing, crafting, building, foraging (softmax, as now) |
| Moving | restlessness; what a new camp should have: fruit, game, fish, wood, close by (5 preferences that score candidate sites) |
| Clan | eagerness to split when big; generosity to friends; openness to strangers (meeting and marrying) |
| Memory | 6 numbers written back as memory |

The new decisions go through **existing** game rules. The camp preferences only change how candidate sites are
scored; the split eagerness moves the split size within ±20% of today's limits. The brain never gets a new power the
simulation does not already have.

## How a culture learns

Every **trial period** (2 years, as now):

1. Every clan of the culture lives the period with `shared network + σ · noise_i`. The noise comes from the world's
   seed, the culture and the period, so it never needs saving and every replay is the same. Clans are paired with
   **mirrored** noise (+noise and −noise), which halves the luck.
2. At the end, each clan's **score** = how much better it did than over its previous period (improvement, not raw
   size, so a clan on poor land counts as much as one on rich land): food (capped), growth including daughter clans,
   survival of children.
3. Scores are **ranked** inside the culture (best = +0.5, worst = −0.5), so one lucky clan cannot drag everyone along.
4. The shared network moves by `rate · Σ rank_i · noise_i / (n · σ)`, with a little weight decay.
5. σ and the rate tune themselves from how much the scores improve (the same idea as today's daring).

**Small cultures** (fewer than 4 clans) fall back to today's keep-or-throw-away learning for each clan.

**Culture split**: a culture with more than 14 clans splits into two along its family tree; each half takes a copy
of the network and goes its own way. So the world grows several schools of thought.

**Cultural diffusion**: allied clans of different cultures can trade lessons: now and then a culture blends a little
of a friendly culture's network into its own, and keeps it only if its next period is not worse.

**Old brains**: on the first load of a 1.x world, every clan's Brain 1 is kept as a fallback, and each culture's new
network starts from a blend of its clans' old job habits (trained to imitate them for a few hundred steps), so a
running world does not forget everything on upgrade.

## Speed

Today a month takes about 0.5 ms for all brains. Brain 2 has 8× the weights. Plan:
- Clans in a culture share the base network; only the noise differs, so each clan computes `base + σ·noise` once per
  period and caches its effective weights (no per-month noise generation).
- Plain `Float32Array` math, no allocation per month.
- Budget: under 5 ms per month for 400 clans. Measured before merging.

## What the page shows

- **Culture card** (from a clan card): the culture's name, its clans on the map, generations of learning, the learning
  curve, what it does differently from its neighbours.
- **Brain drawing**: the two hidden layers, the memory cells lighting up over the months.
- **Dashboard**: cultures over time (a family tree of schools of thought), how each learns.
- **Chronicle**: "The Pine culture learned to store food before winter" — only for big, lasting changes in behaviour,
  confirmed over several periods (as in 1.40).

## Steps

1. **Measure first**: a fixed benchmark of 6 worlds × 3,000 years with today's brain (food, growth, survival, pace of
   discoveries, chronicle mix). Every step below is judged against it.
2. **Network 2** in its own file (`src/server/sim/brain2.ts`): forward pass, memory, effective-weight cache, saving.
   Unit tests: same seed same numbers; save and load mid-period.
3. **Culture learning** with the existing outputs only. Gate: beats Brain 1 on the benchmark.
4. **New senses and memory.** Gate: beats step 3.
5. **New decisions** (camp preferences, split eagerness, openness), one at a time, each behind a switch. Gate: each
   one beats the step before, and no new runaway (biggest clan, population, herding/fishing).
6. **Culture split, diffusion, migration of old brains.**
7. **The page**: culture card, drawing, dashboard, chronicle.
8. **Release checks** (as in 1.40) plus a week-long run at 100×.

## Gates (all must hold to ship)

| Check | Must be |
| --- | --- |
| Against Brain 1 | +10% average population or better, in at least 5 of 6 worlds |
| Against no learning | at least +20% |
| Pace of history | no age reached more than 15% earlier than with Brain 1 |
| Runaways | no clan over 840 people, no world over 25,000 at 5000 BC |
| Save and load | exact (the 1.40 test, with memory and noise) |
| Speed | under 5 ms per month for 400 clans; memory flat over an hour at 100× |
| Old worlds | a 1.40 save loads, keeps its people, and its cultures start from their clans' habits |
| Chronicle | Brain 2 entries under 5% of the chronicle |

## Risks

- **It learns to exploit a rule** (as Brain 1 did with herding). Every new decision goes in alone, with the runaway
  checks on, and old exploits stay in the tests.
- **Too slow to learn to show.** Culture learning is many times more efficient, but a world lives only a few hundred
  periods per age. The benchmark measures what the player would see in a day.
- **Too fast**: clans racing through history. The pace gate stops it, and discovery chances are untouched by the brain.
- **Harder to explain.** The culture card and the chronicle must say in plain words what a culture learned.

## Findings so far (branch `brain2`)

Benchmark: 6 worlds (seeds 3, 5, 11, 21, 42, 77), average population over the second half of the run (`npm run bench`).

| Run | Learning | Frozen networks |
| --- | --- | --- |
| Brain 1 (1.40), 3,000 years | 1,352 | 1,644 |
| Brain 2, first version, 3,000 years | 1,375 | 1,555 |
| Brain 2, food-per-need score, six settings, 2,000 years | 694–788 | 795 |
| Brain 2 with a stewardship reward, 2,000 years | 754–784 | 850 |

Fixed plans for every clan, 2,000 years: herd and fish **1,361** (best in all 6 worlds), even split 731, never move early 737,
restless 805, mostly forage 389.

What this says:
- **Decisions matter a lot** (herding and fishing beat an even split by 86%), so there is something to learn.
- **Neither brain learns it.** Brain 1's learning even costs about 18%. Brain 2 is about even with frozen networks,
  with more varied ways of life (variety 3.0–3.6 vs 2.2–2.5).
- **Likely cause: a tragedy of the commons.** For one clan on full land, foraging brings in more than fishing; herding and
  fishing win only when everyone does them and the shared fruit and game recover. A score that sees one clan cannot see that.
- The spread between worlds is large (frozen runs 176–1,346), so a 6-world mean moves by about ±100 between runs.

Next options: judge whole cultures against each other (group selection, so a region keeps what it saves), or change the
game so restraint pays a single clan too (stripped land recovers more slowly, or foraging falls off sooner on worn land).

## What made it work (shipped in 1.50)

The learning itself was never broken: scored on a made-up goal (work given to herding and fishing) the cultures pushed it
from 34% to 90% in 600 years. What was wrong was **what they were scored on**:

| Fixed plan for every clan (2 worlds, 1,500 years) | People | Food-against-need score |
| --- | --- | --- |
| mostly foraging | 334 / 579 (smallest) | highest |
| even | 489 / 667 | |
| herd and fish | 745 / 907 | |
| mostly crafting | 1,104 / 1,412 (biggest) | lowest |

Foraging brings in the most food each month and strips the land; crafting at camp spares the land and makes every worker
more productive. Land fullness and two-year growth did not tell plans apart either (a settled world sits at its carrying
capacity). Switching a settled world from the even plan to crafting showed why: about +3% in two years (lost in the noise)
but +12% in ten. So Brain 2 now scores a culture **only on its growth, over five-year periods**, two-sided (five years with
+noise, five with -noise), and cultures copy neighbours that **grow** faster.

| Benchmark | Learning | Frozen | Won |
| --- | --- | --- | --- |
| 12 new worlds, 2,000 years | 1,215 | 855 (+42%) | 11 of 12 |
| original 6 worlds, 3,000 years | 2,783 | 1,480 (+88%) | 6 of 6 |

Over 3,000 years it also beat Brain 1 (1,352) in 6 of 6 and the best hand-written plan, all-crafting (2,003), in 6 of 6.
Same 23 discoveries in every world (the ages keep their pace), biggest clan 60. Cost: about 2.5x the simulation time per
month, from the bigger population. Ways of life are a little less varied (2.1 against 2.2-2.5), since many cultures find
the same answer.

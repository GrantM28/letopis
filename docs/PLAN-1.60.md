# Plan: 1.60, a world you can see and keep safe

This is our own version of Letopis: nothing is merged from the original any more. 1.60 is reached in steps, each one
released on its own (1.51 to 1.59), each one tested and pushed when it is ready.

## What 1.60 brings

- **Your world is safe**: daily backups, and an admin page to roll back or start a new world.
- **You can see what the world is doing**: cultures coloured on the map, trade routes between villages, and a history of
  the whole world you can scroll, print and share.
- **A new layer of history**: realms, allied villages joined under one capital and one ruler.

## The releases

| Version | What | Size |
| --- | --- | --- |
| 1.51 | Daily backups of the world (done) | small |
| 1.52 | Admin page: backups, roll back, new world from a seed, server health (done) | medium |
| 1.53 | Cultures on the map (done) | medium |
| 1.54 | Culture cards and culture news (done) | small |
| 1.55 | Kids mode removed (done; not in the first plan) | small |
| 1.56 | Trade routes between allied villages | medium |
| 1.57 | History view | medium |
| 1.58 | Book of the world (print and share) | small |
| 1.59 | Realms: how they form, on the map, in the chronicle | large |
| 1.60 | Realms: rulers, succession, what a realm does; then everything together (long run to the Iron Age, speed, polish) | large |

The sections below keep their first numbers: 1.55 trade routes is now 1.56, and so on; 1.59 and 1.60 are one release.

---

### 1.51 Daily backups

- Once a day (real time) the server copies the world save to `/data/backups/world-<date>-<year>.json.gz`, keeping the
  last 14 (`LETOPIS_BACKUPS`, 0 turns them off). Also one before every new world and every roll back.
- Only the world save is copied (5 to 15 MB), not the chronicle database (up to gigabytes). A roll back instead removes
  what the database wrote after the backup (see 1.52), so the two always match.
- Written in the background like the autosave, so the game never stalls.
- **Done when**: backups appear on schedule, the oldest are removed, a backup loads as a world (test), README explains it.

### 1.52 Admin page

- `/admin`, off unless `LETOPIS_ADMIN_TOKEN` is set on the container. You type the token once; the server answers with a
  cookie (HttpOnly, SameSite=Strict, 30 days). The token is never in a URL. Wrong tokens are slowed down.
- **Backups**: list (date, world year, people, size), make one now, **roll back** to one: the world is replaced, and the
  chronicle, the dead, the yearly statistics and the gone clans after that moment are deleted, so history matches again.
  The chronicle notes "The world was turned back to <year>".
- **New world**: from a seed you choose (or a random one). The current world is archived first, as when a world dies out.
- **Health**: people, clans, month time, memory, database and save sizes, the last backup, the speed of time.
- Every action asks for confirmation and says what cannot be undone.
- **Done when**: tests for the token, the cookie, roll back (database matches the world afterwards) and new world;
  checked in the browser; the token never appears in logs or URLs.

### 1.53 Cultures on the map

- Each culture gets a colour (a daughter culture a shade of its parent's, so families of cultures look related).
- A **Cultures** button in the map toolbar tints the land around every clan of a culture in its colour (soft edges,
  drawn once into a small texture, cheap at any zoom), with the culture's name over its middle when zoomed out.
- The minimap shows the same tint while the layer is on.
- Clicking tinted land opens the culture (1.54).
- **Done when**: on in a 40,000-person world without frame drops; colours stay the same across reloads; phone layout ok.

### 1.54 Culture cards and culture news

- A culture card: its clans (each clickable, and highlighted on the map), when and from whom it split, which cultures it
  took ways from, its learning steps, its growth over time (a small line chart), and what its network leans to.
- The chronicle tells a culture split ("The culture of the Grey Peak parted: the eastern clans follow the White Bear now")
  and keeps the "took up the ways of" entries; both in the Clans filter, hidden by Story.
- The Stats page lists the biggest cultures with links.

### 1.55 Trade routes

- Two allied villages within reach that a road joins become **trading partners**. The route follows the road.
- Drawn as a dotted line along the road with small carts moving along it; a **Trade** button shows or hides routes.
- What trade does: the food evening-out that already happens between traders, plus a small shared chance of discoveries
  along the route. **Measured with the benchmark first**: it must not make worlds explode or rush the ages.
- Chronicle: "The village of X and the village of Y opened a trade road", and when a route breaks (a feud, a village gone).

### 1.56 History view

- A **History** button opens a full-screen page: one scrolling timeline of the world, newest at the top or the oldest.
  - the ages, with when each began
  - the first discoveries, each with who found it
  - great people: discoverers, long-lived elders, founders of cultures and (later) realms
  - cultures founding and splitting, realms rising and falling
  - the population as a slim chart running down the side, with plagues, famines and booms marked
- Filters: everything, people, discoveries, cultures, realms. Each entry opens its card.
- Built from what is already kept (chronicle entries of importance 2 and 3, the yearly statistics, the dead), so it
  works for worlds that started before 1.56.

### 1.57 Book of the world

- `/book`: the same history as a readable page in chapters, one per age, with the world's map, its numbers and its
  great names. Print it, save it as PDF from the browser, or share the link.
- A button on the History page and on the admin page.

### 1.58 Realms: forming

- Villages that have been **allied for a long time** (say 50 years), are joined by road and lie within reach form a
  **realm**. Other villages allied to a realm's capital may join it.
- The **capital** is its biggest village; the **ruler** is the capital's elder. The title grows with the age: chiefdom
  (New Stone Age), kingdom (Bronze and Iron Age), and so on.
- The name comes from the capital or its culture ("the Realm of Dolno Yavovitsa").
- A realm ends when its capital is gone, its villages fall into feuds, or it shrinks to one village.
- Map: a **Realms** layer with borders around a realm's villages and its name; the capital marked.
- Chronicle: founding, joining, leaving, the end of a realm (big news, importance 2 to 3).
- No wars: as in the rest of the game, rivals quarrel, they do not fight.

### 1.59 Realms: rulers and what a realm does

- **Succession**: when a ruler dies the title passes to the heir (a child in the capital) or else to the capital's
  new elder; dynasties are named and counted ("the third of the House of Stoyan").
- What a realm does: villages of a realm send food to each other in a hungry year, and knowledge spreads faster inside it.
  **Measured with the benchmark**, as trade.
- A realm card: capital, ruler and dynasty, villages, people, founding, its history.
- Stats page: realms over time, biggest realm, longest dynasty.

### 1.60 Everything together

- A long run through the Iron Age with cultures, trade and realms: pacing (each age within 15% of its target), no
  population explosion, month time in budget.
- **Speed**: the one known slow spot in big worlds, removing a dead person from the list of the living (it searches the
  whole list each time), and anything the long run finds.
- README and docs/FORK.md brought up to date; a 1.60 summary in the chronicle's "while you were away".

## How every release is checked

- `npm run build && npm test` green (new tests for each feature); CI runs them before building the image.
- Anything that changes how the world lives (trade, realms) goes through the brain benchmark (`npm run bench`, many
  worlds) and a long run (`tools/longrun.ts`): worlds must not grow past the gates or reach ages early.
- Anything on the page is checked in the browser, on a phone width too.
- Old worlds keep working: every new field in the save is optional, and an old save loads (test).
- README updated, version bumped, pushed; the GitHub build confirmed.

## Not in 1.60

- Nothing merged from the original game.
- No AI service: everything stays inside the simulation.
- Later-age sprite art (waiting for your sheets); wars.

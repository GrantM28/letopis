<p align="center"><img src="art/social-preview.png" alt="Letopis"></p>

<h1 align="center">Letopis</h1>

<p align="center"><i>An idle civilization that lives on its own server. You just watch it grow.</i></p>

<p align="center"><img src="art/screenshot.png" alt="A Stone Age world in Letopis" width="800"></p>

Letopis (Bulgarian for *chronicle*) is a self-hosted idle simulation. A few families start in the Stone Age
and, with nobody pressing a button, discover fire, tools, farming and everything after, all the way to the stars.
Open the page whenever you like and see how far they got. The world keeps living on the server while nobody is watching.

This is [GrantM28's fork](https://github.com/GrantM28/letopis) of [leppermesiah/letopis](https://github.com/leppermesiah/letopis).
It adds the ages after the Bronze Age, more world events, a statistics dashboard, notifications, a few ways to lend the world a hand,
and a reworked, English-only interface. Upstream changes are merged in from time to time.

## Features

- A generated world with relief, rivers, forests, mountains, seasons and snow, drawn in a cozy isometric pixel-art style.
- **Pixel look** (on by default, the grid button in the toolbar): the map is drawn in chunky pixels with a warm 32-colour palette
  for a retro 8-bit feel, while names and panels stay sharp. Turn it off for the smooth painted look.
- Every person has a name, parents, children and traits (strength, wit, curiosity, sociability, health, longevity) that are inherited with small mutations.
- Clans wander, split, meet, learn from each other, settle into villages and sometimes die out together with their knowledge.
- Trees grow and get cut for fires and huts; a clan moves on when the wood around its camp is gone.
- **Nine ages and 80 discoveries**: Stone, New Stone and Bronze Age, then the Iron Age, Middle Ages, Early Modern, Industrial,
  Information and Space Age. Each age opens with one discovery (iron, the watermill, the printing press, the steam engine,
  the computer, a Moon base). Discoveries change the world: better tools and farming, medicine and vaccines against disease,
  bigger castle towns, railways that bring clans together, universities and printing that speed up new ideas.
- **Later-age buildings on the map**: villages that know them show a forge, castle, mills, a ship, an observatory, a factory, a train,
  radio masts, office blocks, solar panels, rockets, a dome on the Moon and more.
- **World events**: floods, plagues (milder with medicine), rich harvests, comets, eclipses, earthquakes, town fires, festivals,
  great buildings of each age and expeditions, alongside great hunts, hard winters and droughts.
- **Friends and rivals**: neighbouring clans warm or cool towards each other. Clans that split from one another, trade or
  write tend to become allies who send food in a bad year and grow richer from trade; hungry clans crowding the same land
  become rivals who quarrel over hunting grounds (nothing violent on screen). Alliances, rivalries and reconciliations go in the chronicle.
- **Help the world**: now and then you may send a blessing (food for the hungriest clan), rain (over the driest land) or call a feast.
  Each has a cooldown shared by everyone watching, and each is written in the chronicle.
- A living chronicle with filters (important, discoveries, life, clans, nature), clickable people and clans,
  family trees back to the first humans, and every discovery grouped by age with progress bars.
- **Statistics dashboard**: population and clans over time with the ages marked, births and deaths per year, discoveries over time,
  the age make-up of the living, records (most people, largest clan, oldest person), how people died, what happened most, and the timeline of the ages.
- **People tab**: everyone alive, searchable and sortable (oldest, youngest, name, most deeds, most children), plus the notable ones.
- **Clans tab**: search, sort by size, knowledge or name, with each clan's chief and size. A clan's card shows its age,
  children, elders and food, its friends and rivals, what its people are doing, what it knows and everyone in it.
- **World map** in the corner: the explored land, every clan, and the part you are looking at. Click or drag on it to go there;
  the map button in the toolbar hides it.
- The top bar shows how far the world is through the discoveries of its age and which age comes next.
- **Notifications** to your phone (ntfy) or Home Assistant (webhook) when a new age begins or a great first discovery is made.
- Kids mode with bigger letters and simpler explanations.
- "While you were away": the highlights since your last visit.
- Tour mode: the camera wanders the world by itself and stops where something happens. Nice on a TV.
- 100 tiny secrets hidden around every world.

## Pace

About three months of real time take the world from the Stone Age to the present day; after that it keeps going at the same pace.
The Stone Age is the fastest (a year in about 3 minutes), the modern centuries the slowest (a year in about 1.5 hours).
Each discovery has a target date, and its chance rises or falls when the world runs ahead of or behind history.

## Running it

### Docker

```sh
docker run -d --name letopis -p 2222:2222 -v /path/to/letopis-data:/data --restart unless-stopped ghcr.io/grantm28/letopis:latest
```

Then open `http://<host>:2222/`.

### Unraid

In the **Docker** tab choose **Add Container** and fill in:

- Repository: `ghcr.io/grantm28/letopis:latest`
- Port: `2222` → `2222`
- Path: `/data` → `/mnt/user/appdata/letopis`
- WebUI (optional): `http://[IP]:[PORT:2222]/`

To update, use **Force update** on the container. The world is saved every 2 minutes and when the container stops,
and continues where it left off after a restart. If humanity dies out, the world is archived in `/data/archive/`
and a new one begins a minute later.

### Settings (environment)

| Variable | Default | Meaning |
|---|---|---|
| `LETOPIS_PORT` | `2222` | web port |
| `LETOPIS_DATA` | `/data` | where the world, the chronicle (SQLite) and the archive live |
| `LETOPIS_SPEED` | `1` | time multiplier, only for testing |
| `LETOPIS_SEED` | random | seed of the first world |
| `LETOPIS_NTFY_URL` | – | an [ntfy](https://ntfy.sh) topic URL (e.g. `https://ntfy.sh/my-letopis`) for phone notifications |
| `LETOPIS_WEBHOOK_URL` | – | a URL that gets a JSON `POST` for each great moment (e.g. a Home Assistant webhook) |
| `LETOPIS_NOTIFY_MIN` | `3` | the least importance that is sent: 3 = new ages and first discoveries, 2 = also plagues, wonders, comets and the like |
| `TZ` | `Europe/Sofia` | time zone |

The webhook body is `{ "title", "message", "kind", "importance", "year", "world" }`. At most four notifications go out per minute.

## Building from source

Requires Node.js 22.

```sh
npm ci
npm run dev     # runs at x200 speed with data in ./data, http://localhost:2222 (macOS/Linux shell syntax)
npm run build   # production build into dist/
npm run typecheck
npm run simtest -- 42 6000 500   # simulate 6000 years of world 42 without the server, printing every 500 years
```

On Windows, start the dev server from `.claude/launch.json` or set `LETOPIS_DATA=./data` and `LETOPIS_SPEED=200` yourself
before `node --disable-warning=ExperimentalWarning dist/server.js`.

Pushing to `main` builds the Docker image with GitHub Actions and publishes it as `ghcr.io/grantm28/letopis:latest`.

### Where things are

| Path | What |
|---|---|
| `src/server/sim/sim.ts` | the simulation (upstream) |
| `src/server/sim/tech.ts`, `src/shared/later_techs.ts` | the discoveries; the Iron Age and later live in `later_techs.ts` |
| `src/server/sim/events.ts`, `src/shared/event_words.ts` | the world events and the acts of the watchers |
| `src/server/sim/relations.ts` | friendship and rivalry between neighbouring clans |
| `src/client/minimap.ts` | the world map in the corner |
| `src/client/pixel.ts` | the pixel look: a shader that draws the map in big pixels and pulls colours to the palette |
| `src/server/extras.ts` | yearly history, records, people list and acts (`/api/history`, `/api/people`, `/api/acts`) |
| `src/server/notify.ts` | ntfy and webhook notifications |
| `src/client/main.ts`, `public/` | the page: panels, tabs, cards |
| `src/client/render.ts`, `src/client/landmarks.ts` | the map; later-age buildings are drawn in code in `landmarks.ts` |
| `src/client/charts.ts` | the charts of the statistics dashboard |

The fork keeps its additions in their own files where it can, so upstream updates merge with few conflicts.

### Graphics

The sprite sheets live in `art/sheets/`.
After changing or adding a sheet (needs Python, Pillow and NumPy):

```sh
python3 -I tools/slice_sprites.py   # cuts the sheets into single sprites in art/cut/ and cleans the halos
python3 -I tools/build_atlas.py     # builds public/sprites/atlas*.png and atlas.json
```

The finished atlas is in git, so Python is not needed to build the game.

## API

`/api/health`, `/api/world`, `/api/snapshot`, `/api/chronicle?before=&after=&min=&limit=`, `/api/since?after=`,
`/api/person/:id`, `/api/tree/:id`, `/api/band/:id`, `/api/heroes`, `/api/discoveries`, `/api/stats`, `/api/worlds`, WebSocket `/ws`.

Added in this fork: `/api/history` (yearly series, causes of death, event counts, records, the ages),
`/api/people?q=&band=&sort=old|young|name|deeds|children&offset=&limit=` (everyone alive), `/api/relations/:bandId` (a clan's friends and rivals),
`/api/acts` and `POST /api/act/bless|rain|feast`.

`/api/health` works well as a sensor for Home Assistant or any uptime monitor.

## Roadmap

- Sprite-sheet art for the later ages, to replace the code-drawn buildings.
- States: allied towns joining into one realm, with trade roads drawn on the map.
- A longer test of the pacing of the later ages.

## Credits

Everything taken from outside, with its author and license, is listed in [CREDITS.md](CREDITS.md).
The game was created by [leppermesiah](https://github.com/leppermesiah/letopis).

## License

[MIT](LICENSE). The third-party libraries keep their own licenses, listed in [CREDITS.md](CREDITS.md).

# Plan: 1.60, the whole page reworked

Asked for on 2026-11-10: "rework the entire UI. I want things like the clan card and brain diagram easier to read and
other various UI changes and improvements." This plan comes from going through the page as it is in 1.59.

## What is wrong now (measured on a 49,000-person world)

| # | Where | Problem |
| --- | --- | --- |
| 1 | Clan card | **2,792 px tall, 2,249 words**, six sections in one scroll. The header alone is four lines of small print. |
| 2 | Clan card | The same ~130-word explanation of how cultures learn is repeated on **every** clan card; the culture's clan list (up to 14 links) too. |
| 3 | Brain drawing | **30 labels about 7 px high**, a few hundred crossing lines; nothing can be read at a glance. |
| 4 | Brain numbers | "×4.00 now · ×3.85 this year": a multiplier nobody knows the meaning of; the floor ×0.15 looks like real data. |
| 5 | Clan card | "Food 0" for a well-fed village (it is the stores, eaten each month); help buttons sit in the middle of the card. |
| 6 | Toolbar | **12 buttons**, icon-only below about 1,300 px wide; map layers (cultures, realms, trade, night) mixed with actions. |
| 7 | All cards | Clan, culture, realm, person and discovery cards each have their own header and layout. |
| 8 | Explanations | Long "how it works" paragraphs on cards and on the Stats page, repeated, instead of one place to read them. |
| 9 | Side panel | Seven filter chips; every chronicle entry looks the same; a hovered tab looks selected. |
| 10 | Phone | Cards are a box in the middle of the screen; the toolbar wraps onto two rows. |

The person card (366 px, a clear header, one list of family) is the model for the rest: short, scannable, links.

## The design

### One card, everywhere

Every card (clan, culture, realm, person, discovery) is built the same way:

```
┌──────────────────────────────────────────────┐
│ ● Medovitsa                              ×   │  colour dot, name
│ village · Iron Age · since 7,961 BC          │  one line of facts
│ [🌐 Blue Shore II] [♛ Empire of Bistreshnitsa]│  chips: its culture, its realm, ...
├──────────────────────────────────────────────┤
│  373 people │ 133 children │ 10 elders │ ... │  at most four numbers
├──────────────────────────────────────────────┤
│ Overview   Brain   Neighbours   People       │  tabs (only what that card needs)
├──────────────────────────────────────────────┤
│ ... the tab ...                               │
└──────────────────────────────────────────────┘
```

- Wider (560 px), body text 15 px, small print never under 12 px.
- A "?" in the corner opens the right part of the new **How it works** page (below) instead of paragraphs on the card.
- On a phone a card is a full-height sheet from the bottom, with the tabs at the top.

### The clan card

- **Overview**: what they do (plain percentages: "Crafting 62%"), their stores of food in words (plenty / enough / running low),
  their newest discoveries (five, and "68 in all" opening the list), and the help buttons at the bottom.
- **Brain**: below.
- **Neighbours**: friends and rivals, its realm and its rulers, its trade partners, its culture.
- **People**: everyone, the chief first.

### The Brain tab

The drawing of the whole network moves behind a button. What comes first is what the brain is doing and why:

1. **Right now**: how the work is shared, as plain percentage bars; how restless (for wanderers) and how generous, as
   two small gauges.
2. **Why**: the three to five strongest reasons, in words, worked out on the server by nudging each sense and seeing
   what moves: "When food stores run low, they fish more", "In winter they craft less", "With rivals near, they move on
   sooner". Each with a small up or down arrow.
3. **What it senses**: the 18 senses in six labelled groups (Season, Food, Land, People, Neighbours, How the last five
   years went), each a short bar; the six memory cells as a row of six small lights.
4. **How it learns**: one sentence and a link to its culture card; the culture's learning steps and whether the last
   five years went better.
5. **Show the network** (button): a new drawing at full card width and twice the height: inputs grouped under their
   group names, only each neuron's three strongest links, labels at 12 px, and pointing at a decision lights the paths
   that feed it.

### How it works (new page)

One page, reached from a "?" on every card and from the toolbar: the brain and how a culture learns, cultures, realms
and rulers, trade, the powers and prayers, the ages and discoveries, backups and the admin page. Written once, short,
with small pictures. The cards and the Stats page lose their long paragraphs.

### The toolbar

```
[−][+][⌂][🗺]      [✨ Help 5] [📖 History] [◧ Layers ▾] [🎥 Tour] [▤ Panel] [? ]
                                 ├ ☑ Cultures
                                 ├ ☐ Realms
                                 ├ ☐ Trade
                                 └ ☑ Night
```

- Map layers go into one **Layers** menu with checkboxes; labels shown whenever there is room; on a phone one row, with
  the rest under "More".

### The side panel

- Fewer filters: All, Story, Discoveries, Life, Clans, Nature (Story covers "Important").
- Chronicle entries by weight: great moments in bold with a coloured edge, small ones lighter; a year heading when the
  year changes instead of the year on every line.
- A clear selected tab (filled) unlike a hovered one (outlined).

### The other cards

- **Culture**: Overview (its people over time, how its clans work), Clans, Lineage (split from, daughters, who it learned from).
- **Realm**: Overview (ruler and house, capital, people), Villages, Rulers (the line of rulers as a small family list).
- **Discovery**: as now, on the new card layout.
- **Person**: as now, on the new layout; adds the realm a ruler rules.

## Steps

The work goes on a branch, `ui-1.60`, with a look at each step in the browser (desktop and phone width), and ships
together as 1.60.

1. **The card**: the shared layout (header, chips, numbers, tabs, sheet on a phone) and its styles; the person card moved
   onto it first.
2. **The clan card** on tabs: Overview, Neighbours, People.
3. **The Brain tab**: the server works out the reasons ("why"); right now, why, senses, how it learns; the new network
   drawing behind its button.
4. **Culture, realm and discovery cards** on the new layout.
5. **How it works** page; the long paragraphs leave the cards and the Stats page.
6. **Toolbar and Layers menu**; side panel filters, entry weights, tab look.
7. **Phone**: card sheets, one-row toolbar.
8. **Together**: a long run (speed: the one known slow spot, removing the dead from the list of the living), every
   card and tab checked on desktop and phone, before-and-after screenshots in the README, tests, version 1.60.

## How it is checked

- Every step in the browser at desktop and phone width; nothing scrolls sideways; no text under 12 px.
- The clan card's first screen answers "who are they, how many, what do they do, how are they doing" without scrolling.
- The Brain tab's first screen can be read without knowing what a neural network is.
- `npm test` green; the page tested on the big dev world (49,000 people) for speed.
- Old saves load (nothing in the save changes for the UI).

## Not in 1.60

- New gameplay (realms, trade and cultures came in 1.53 to 1.59).
- A light theme (could follow).
- Later-age sprite art (waiting for the sheets).

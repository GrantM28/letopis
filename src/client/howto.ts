// How it works (1.60): every explanation in one place, written once and short. Opened from the "?" on a card (at the
// right part) and from the toolbar; the cards and the Stats page keep only a line each.
import { $ } from './kit';

const PARTS: [string, string, string][] = [
  ['world', 'The world', `
    <p>A world lives on its own on your server, a month every few seconds at the normal pace: from 12,000 BC, three clans who
      do not yet know fire, onward through the ages. People are born, pair up, work, discover, grow old and die; clans wander,
      split, settle into villages, make friends and rivals. Nobody plays it; you watch, and now and then lend a hand.</p>
    <p>The chronicle on the right tells what happens. <b>Story</b> shows the history without everyday life; the other filters
      narrow it down. Every name is a link.</p>`],
  ['brain', 'A clan\'s brain', `
    <p>Every month a small neural network looks at a clan's situation and decides three things: how its people share their work
      between farming, herding, fishing, crafting, building and hunting and gathering; how generous it is with friends; and,
      for wanderers, whether to move on early.</p>
    <p>It <b>senses</b> 18 things (the season, hunger and stores, the fruit, game, fish and wood around, its size, children and
      elders, how crowded the land is, friends and rivals nearby, the age of the world, how the last five years went) and keeps
      six numbers of its own from month to month, a <b>memory</b> whose meaning it chose itself.</p>
    <p>On a clan's <b>Brain</b> tab, <i>Right now</i> shows how it leans on each job against an even share; <i>Why</i> gives its
      strongest reasons, found by nudging each sense and seeing what moves; <i>Show the network</i> draws the network itself:
      green links add, red ones hold back, and pointing at a decision lights what feeds it.</p>`],
  ['cultures', 'Cultures: how the brains learn', `
    <p>Clans that come from the same first clans form a <b>culture</b> and share one brain. Nobody wrote its strategy: the culture
      learns it. All its clans live five years with one small change to the network, then five years with the opposite change,
      and the culture keeps moving whichever way made it grow more. Growth is what counts, because food alone rewarded stripping
      the land.</p>
    <p>A culture growing clearly slower than one nearby takes up part of its ways, and a culture grown past 14 clans splits in two
      along the land. The <b>Cultures</b> layer colours each culture's land; a daughter culture is a shade of its parent's.</p>
    <p>Measured: learning cultures grow worlds 42% bigger than the same brains frozen, and found by themselves that crafting at camp,
      which spares the land, beats foraging.</p>`],
  ['realms', 'Realms and rulers', `
    <p>From the New Stone Age, villages allied for 30 years and joined by road become a <b>realm</b>: a chiefdom, later a kingdom,
      in later ages an empire when it holds eight villages or more. Its biggest village is the capital.</p>
    <p>A ruler reigns for life. When one dies, their oldest grown child in the realm follows and carries on the <b>house</b>; with
      no such child the capital's elder starts a new one. Long allies join; a village that turns against its capital leaves; a realm
      whose capital is gone moves it, and one left with a single village ends. In a hungry year a realm's villages send food to the
      hungriest. There are no wars: rivals quarrel, as ever.</p>`],
  ['trade', 'Trade', `
    <p>Two allied villages that both know trade (around 2,800 BC) and are joined by a road trade along it: the <b>Trade</b> layer
      draws the route with carts going to and fro. Trading neighbours even out a good and a bad harvest.</p>`],
  ['powers', 'Lending a hand', `
    <p>The <b>Help</b> button holds five powers: a blessing (food), rain, a feast with the neighbours, inspiration (four times the
      chance of a discovery for two years) and calming a feud. Each has a waiting time shared by everyone watching. On a clan's card
      they go to that clan; otherwise to where they are needed most.</p>
    <p>Clans in trouble <b>pray</b>: for food, rain or peace. The number on the Help button counts the prayers; answer one before it
      fades.</p>`],
  ['ages', 'Ages and discoveries', `
    <p>Nine ages, from the Stone Age to the Space Age, each opened by one discovery. A discovery is found by a real person in a real
      clan, spreads to neighbours, and can be forgotten when the last clan that knew it is gone. Each has a date in real history, and
      its chance rises or falls when the world runs ahead of or behind it, so the ages keep their pace whatever the brains learn.</p>
    <p>The <b>History</b> button shows the whole world on one page; <b>The book of the world</b> (from History) is the same as a
      page to print or share.</p>`],
  ['layers', 'The map', `
    <p>The <b>Layers</b> menu colours the land by culture or by realm, draws the trade routes, and turns the night on or off. Zoomed
      out with a layer on, the clans' own name tags step back. The small map in the corner shows the explored land; click it to go there.</p>`],
  ['admin', 'Backups and the admin page', `
    <p>Once a day the world is copied to <code>/data/backups</code> (the newest 14 are kept). With <code>LETOPIS_ADMIN_TOKEN</code> set on
      the container, <code>/admin</code> shows how the server is doing and lets you back up now, roll back to a backup, or start a new
      world from a seed.</p>`],
];

function page(): HTMLElement {
  let el = document.getElementById('howto');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'howto';
  el.className = 'history howto';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'How it works');
  el.innerHTML = `<div class="hist-inner">
    <header class="hist-head"><h2>How it works</h2><button class="btn round" id="howClose" title="Close" aria-label="Close">×</button></header>
    <nav class="how-nav">${PARTS.map(([id, t]) => `<a href="#how-${id}" data-how="${id}">${t}</a>`).join('')}</nav>
    ${PARTS.map(([id, t, html]) => `<section class="how-part" id="how-${id}"><h3>${t}</h3>${html}</section>`).join('')}</div>`;
  document.body.appendChild(el);
  $('#howClose').onclick = () => { el!.hidden = true; };
  el.querySelectorAll<HTMLAnchorElement>('[data-how]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); go(a.dataset.how!); }; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el!.hidden && document.getElementById('card')?.hidden !== false) el!.hidden = true; });
  return el;
}

function go(part: string) {
  const el = page();
  const target = el.querySelector<HTMLElement>(`#how-${part}`);
  // (below the sticky menu of parts)
  if (target) el.scrollTop = target.offsetTop - (el.querySelector<HTMLElement>('.how-nav')?.offsetHeight ?? 0) - 20;
  el.querySelectorAll('.how-part').forEach((s) => s.classList.toggle('lit', s.id === `how-${part}`));
}

export function openHowTo(part = 'world') {
  const el = page();
  el.hidden = false;
  setTimeout(() => go(part), 0);
}

export function initHowTo() {
  // a "?" on any card opens its part of the page
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.ck-help');
    if (b) { e.preventDefault(); openHowTo(b.dataset.help); }
  });
}

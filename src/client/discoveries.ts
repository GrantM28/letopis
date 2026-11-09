// The fork's discoveries: the Discoveries tab (every age, search, filters) and the card for each discovery.
import { TECH_DESC, TECH_LIST } from '../shared/i18n';
import { fmtYear } from './lang';
import { $, api, esc, ui } from './kit';

/** ages opened in the discoveries tab; until one is touched, only the current age is open */
const openAges = new Set<number>();
let openAgesTouched = false;

type TreeTech = { id: string; era: number; year: number; prereq: string[]; need: string | null; knownBy: number; discovered: boolean;
  first: { who: string; pid: number; band: string; year: number } | null };
let discQuery = '';
let discFilter: 'all' | 'done' | 'reach' | 'todo' = 'all';
async function loadTree() {
  return api<{ clans: number; techs: TreeTech[] }>('/api/techtree').catch(() => null);
}
const NEED_TEXT: Record<string, string> = {
  flint: 'good stone nearby', clay: 'clay nearby', grain: 'wild grain nearby', wildHerd: 'wild herds nearby', fish: 'a river or the sea', forest: 'a forest', ore: 'ore in the ground',
};

export async function showTech(id: string) {
  const tree = await loadTree();
  const t = tree?.techs.find((x) => x.id === id);
  if (!tree || !t) return;
  const byId = new Map(tree.techs.map((x) => [x.id, x]));
  const chip = (x: TreeTech) => `<button class="chip tech-chip ${x.discovered ? 'done' : ''}" data-tech="${x.id}">${x.discovered ? '✓ ' : ''}${esc(ui.techLabel(x.id))}</button>`;
  const needs = t.prereq.map((r) => byId.get(r)).filter(Boolean) as TreeTech[];
  const unlocks = tree.techs.filter((x) => x.prereq.includes(id));
  const ready = needs.every((x) => x.discovered);
  const share = tree.clans ? t.knownBy / tree.clans : 0;
  ui.openCard(`<h2>💡 ${esc(ui.techLabel(id))}</h2>
    <div class="muted">${esc(ui.eraName(t.era))} · in history around ${fmtYear(t.year)}</div>
    <p class="lead" style="margin-top:10px">${esc(TECH_DESC[id]?.[1] ?? '')}</p>
    ${t.discovered && t.first ? `<p>First discovered by ${t.first.pid ? `<a href="#" data-person="${t.first.pid}">${esc(t.first.who)}</a>` : esc(t.first.who)}
        of ${esc(t.first.band)} in <b>${fmtYear(t.first.year)}</b>.</p>`
      : `<p class="act-note">${ready ? 'Within reach: every clan that knows what it needs may find it any day now.' : 'Not yet: the world still needs what is listed below.'}</p>`}
    <div class="barrow" style="margin:10px 0"><span class="bl-k">Known by ${t.knownBy} of ${tree.clans} clans</span><span class="bl-v">${Math.round(share * 100)}%</span>
      <div class="bl-bar"><i style="width:${share * 100}%;background:var(--accent)"></i></div></div>
    <h3>Needs</h3>${needs.length ? `<div class="chips">${needs.map(chip).join('')}</div>` : '<p class="muted">Nothing: anyone can find it.</p>'}
    ${t.need ? `<p class="muted">And ${NEED_TEXT[t.need] ?? t.need}.</p>` : ''}
    <h3>Leads to</h3>${unlocks.length ? `<div class="chips">${unlocks.map(chip).join('')}</div>` : '<p class="muted">Nothing further yet.</p>'}`);
  document.querySelectorAll<HTMLElement>('#cardBody [data-tech]').forEach((el) => { el.onclick = () => void showTech(el.dataset.tech!); });
}

/** the Discoveries tab */
export function renderDiscoveries(body: HTMLElement) {
  body.innerHTML = '<p class="muted">Loading...</p>';
  void loadTree().then((tree) => {
    if (ui.activeTab() !== 'discoveries' || !tree) return;
    const known = new Set(tree.techs.filter((t) => t.discovered).map((t) => t.id));
    const reach = (t: TreeTech) => !t.discovered && t.prereq.every((r) => known.has(r));
    const filters: [typeof discFilter, string][] = [['all', 'All'], ['done', 'Discovered'], ['reach', 'Within reach'], ['todo', 'Not yet']];
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    body.innerHTML = `<div class="overall">
        <div class="age-line"><span>Discoveries made</span><b>${known.size}/${tree.techs.length}</b></div>
        <div class="meter"><i style="width:${pct(known.size, tree.techs.length)}%"></i></div>
        <div class="age-line" style="margin-top:6px"><span>Within reach now</span><b>${tree.techs.filter(reach).length}</b></div>
      </div>
      <label class="search"><svg class="ic"><use href="#i-search"/></svg>
        <input id="discSearch" type="search" placeholder="Find a discovery" value="${esc(discQuery)}" autocomplete="off"></label>
      <div class="chips">${filters.map(([k, n]) => `<button class="chip" data-dfilter="${k}" aria-pressed="${k === discFilter}">${n}</button>`).join('')}</div>
      <div id="discList"></div>`;
    const draw = () => {
      const q = discQuery.trim().toLowerCase();
      const pass = (t: TreeTech) => (discFilter === 'all' || (discFilter === 'done' && t.discovered) || (discFilter === 'reach' && reach(t)) || (discFilter === 'todo' && !t.discovered))
        && (!q || ui.techLabel(t.id).toLowerCase().includes(q) || (TECH_DESC[t.id]?.[1] ?? '').toLowerCase().includes(q));
      const eras = [...new Set(TECH_LIST.map(([, , e]) => e))];
      const order = new Map(TECH_LIST.map(([id], i) => [id, i]));
      const searching = !!q || discFilter !== 'all';
      $('#discList').innerHTML = eras.map((e) => {
        const all = tree.techs.filter((t) => t.era === e).sort((a, c) => (order.get(a.id) ?? 0) - (order.get(c.id) ?? 0));
        const list = all.filter(pass);
        if (!list.length) return '';
        const n = all.filter((t) => t.discovered).length;
        const state = e === ui.currentEra() ? 'current' : n === all.length ? 'done' : n ? 'started' : '';
        const open = searching || openAges.has(e) || (!openAgesTouched && e === ui.currentEra());
        return `<details class="tech-age ${state}" data-era="${e}"${open ? ' open' : ''}><summary>
            <span class="tech-era">${esc(ui.eraName(e))}${e === ui.currentEra() ? ' <span class="tag">now</span>' : ''}</span>
            <span class="tech-count">${n}/${all.length}</span>
            <div class="meter"><i style="width:${pct(n, all.length)}%"></i></div></summary>
          <ul class="discoveries">${list.map((t) => `<li class="${t.discovered ? '' : reach(t) ? 'todo next' : 'todo'}" data-tech="${t.id}">
            <b>${esc(ui.techLabel(t.id))}</b>${t.discovered && t.first ? ` - discovered by ${t.first.pid ? `<a href="#" class="ref" data-person="${t.first.pid}">${esc(t.first.who)}</a>` : esc(t.first.who)} in <span class="yr">${fmtYear(t.first.year)}</span>`
              : ` - ${esc(TECH_DESC[t.id]?.[1] ?? 'not discovered yet')}`}</li>`).join('')}</ul></details>`;
      }).join('') || '<p class="empty-note">No discovery matches.</p>';
      $('#discList').querySelectorAll<HTMLDetailsElement>('details.tech-age').forEach((d) => {
        d.addEventListener('toggle', () => {
          if (searching) return;
          openAgesTouched = true;
          const e = Number(d.dataset.era);
          if (d.open) openAges.add(e); else openAges.delete(e);
        });
      });
    };
    draw();
    const input = $('#discSearch') as HTMLInputElement;
    input.oninput = () => { discQuery = input.value; draw(); };
    body.querySelectorAll<HTMLButtonElement>('[data-dfilter]').forEach((c) => {
      c.onclick = () => {
        discFilter = c.dataset.dfilter as typeof discFilter;
        body.querySelectorAll('[data-dfilter]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
        draw();
      };
    });
  });
}

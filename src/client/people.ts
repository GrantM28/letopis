// The fork's People tab: everyone alive (searched and sorted on the server, a page at a time) or only the notable ones.
import { TASK_NAMES } from '../shared/types';
import { BL, DEED, P, TASK, num } from './lang';
import { $, api, esc, store, save, ui } from './kit';

/** the people tab: everyone alive (searchable, a page at a time) or only the notable ones */
let peopleView = store<'all' | 'notable'>('letopis.peopleView', 'all');
let peopleSort = store('letopis.peopleSort', 'old');
let peopleQuery = '';
let peopleShown = 0;

export type PersonListRow = { id: number; name: string; age: number; sex: number; band: string; bandId: number; task: string; chief: boolean; deeds: number; children: number; gen: number };
async function loadPeople(more: boolean) {
  const list = document.getElementById('peopleList');
  if (!list) return;
  if (!more) peopleShown = 0;
  const res = await api<{ total: number; people: PersonListRow[] }>(`/api/people?q=${encodeURIComponent(peopleQuery)}&sort=${peopleSort}&offset=${peopleShown}&limit=100`).catch(() => null);
  if (!res || ui.activeTab() !== 'heroes' || peopleView !== 'all') return;
  const color = new Map(ui.bands().map((b) => [b.id, `#${b.color.toString(16).padStart(6, '0')}`]));
  const html = res.people.map((p) => `<li data-person="${p.id}">
      <span class="avatar sm ${p.sex ? 'f' : 'm'}">${p.age < 12 ? '🧒' : p.age >= 60 ? (p.sex ? '👵' : '👴') : p.sex ? '👩' : '👨'}</span>
      <div><b>${esc(p.name)}</b>${p.chief ? ' <span class="badge village">chief</span>' : ''}${p.deeds ? ` <span class="badge">${p.deeds} deed${p.deeds > 1 ? 's' : ''}</span>` : ''}
        <div class="muted"><span class="dot sm" style="background:${color.get(p.bandId) ?? '#888'}"></span>${esc(p.band)} · ${p.age} y · ${esc(TASK(TASK_NAMES[p.task as keyof typeof TASK_NAMES] ?? p.task))}${p.children ? ` · ${p.children} children` : ''}</div></div></li>`).join('');
  if (more) list.insertAdjacentHTML('beforeend', html); else list.innerHTML = html || '<li class="empty-note">Nobody by that name.</li>';
  peopleShown += res.people.length;
  $('#peopleCount').textContent = `${num(res.total)} ${peopleQuery ? 'found' : 'people alive'} · showing ${num(peopleShown)}`;
  ($('#peopleMore') as HTMLElement).hidden = peopleShown >= res.total;
}

/** the People tab */
export function renderPeople(body: HTMLElement) {
  const sorts: [string, string][] = [['old', 'Oldest'], ['young', 'Youngest'], ['name', 'Name'], ['deeds', 'Most deeds'], ['children', 'Most children']];
  body.innerHTML = `<div class="chips seg">
      <button class="chip" data-pview="all" aria-pressed="${peopleView === 'all'}">Everyone</button>
      <button class="chip" data-pview="notable" aria-pressed="${peopleView === 'notable'}">Notable</button></div>
    <div id="peopleBody"></div>`;
  body.querySelectorAll<HTMLButtonElement>('[data-pview]').forEach((c) => {
    c.onclick = () => { peopleView = c.dataset.pview as typeof peopleView; save('letopis.peopleView', peopleView); ui.rerender(); };
  });
  const pb = $('#peopleBody');
  if (peopleView === 'notable') {
    pb.innerHTML = '<p class="muted">Loading...</p>';
    api<{ id: number; name: string; age: number; band: string; deeds: string[] }[]>('/api/heroes').then((hs) => {
      if (ui.activeTab() !== 'heroes' || peopleView !== 'notable') return;
      pb.innerHTML = `<p class="lead">People with deeds to their name, and the old ones who have seen the most.</p>` + (hs.length ? `<ul class="heroes">${hs.map((h) => `<li data-person="${h.id}"><b>${esc(P(h.name))}</b>
        <span class="muted">${h.age} y · ${esc(BL(h.band))}</span>${h.deeds.length ? `<div>${h.deeds.map((x) => esc(DEED(x))).join('<br>')}</div>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">Nobody has done anything great yet. Patience.</p>');
    }).catch(() => { if (ui.activeTab() === 'heroes') pb.innerHTML = '<p class="muted">Could not load the people. Try again in a moment.</p>'; });
  } else {
    pb.innerHTML = `<label class="search"><svg class="ic"><use href="#i-search"/></svg>
        <input id="peopleSearch" type="search" placeholder="Find a person or clan" value="${esc(peopleQuery)}" autocomplete="off"></label>
      <div class="chips">${sorts.map(([k, n]) => `<button class="chip" data-psort="${k}" aria-pressed="${k === peopleSort}">${n}</button>`).join('')}</div>
      <p class="lead" id="peopleCount"></p><ul class="people" id="peopleList"></ul>
      <button class="btn ghost" id="peopleMore" hidden>Show more</button>`;
    const input = $('#peopleSearch') as HTMLInputElement;
    let timer = 0;
    input.oninput = () => { clearTimeout(timer); timer = window.setTimeout(() => { peopleQuery = input.value; void loadPeople(false); }, 250); };
    pb.querySelectorAll<HTMLButtonElement>('[data-psort]').forEach((c) => {
      c.onclick = () => {
        peopleSort = c.dataset.psort!; save('letopis.peopleSort', peopleSort);
        pb.querySelectorAll('[data-psort]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
        void loadPeople(false);
      };
    });
    $('#peopleMore').onclick = () => void loadPeople(true);
    void loadPeople(false);
  }
}

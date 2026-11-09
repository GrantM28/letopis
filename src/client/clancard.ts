// The fork's part of the clan card: help aimed at the clan, its brain, its friends and rivals, and everyone in it.
// main.ts draws the card and calls fillBandCard(); each part loads on its own.
import type { BandView } from '../shared/types';
import { TASK_NAMES } from '../shared/types';
import { TASK } from './lang';
import { $, api, esc } from './kit';
import { useAct } from './help';
import { BrainNet, brainSvg } from './brainview';
import type { PersonListRow } from './people';

export function fillBandCard(b: BandView) {
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  // help aimed at this clan
  document.querySelectorAll<HTMLButtonElement>('#bandHelp [data-help]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const note = $('#bandHelpNote');
      note.hidden = false;
      note.innerHTML = await useAct(btn.dataset.help!, b.id);
      btn.disabled = false;
    };
  });
  // what the clan has learned (brain.ts on the server)
  const JOB_NAMES: Record<string, string> = { farm: 'Farming', herd: 'Herding', fish: 'Fishing', craft: 'Crafting', build: 'Building', forage: 'Hunting and gathering' };
  api<{ style: string; weights: Record<string, number>; now: Record<string, number>; give: number; generation: number; tried: number; kept: number; trying: boolean; inspired: boolean; reactsTo: string[]; network: string; roam: number; copied: number; copiedKept: number; step: number } | null>(`/api/brain/${b.id}`).then((br) => {
    const el = document.getElementById('bandBrain');
    if (!el || !br) { if (el) el.textContent = 'Still finding its way.'; return; }
    el.classList.remove('muted');
    $('#bandStyleTag').textContent = br.style + (br.inspired ? ' · inspired' : '');
    const max = Math.max(...Object.values(br.now), ...Object.values(br.weights));
    el.innerHTML = `<p class="lead">This clan's brain is a small neural network (${esc(br.network)}). Every month it looks at the clan's situation and
        decides how to share the work and when to move on; every two years it judges a slightly changed network and keeps it only if the clan ate better and grew.
        Generation ${br.generation} of its line · ${br.kept} of ${br.tried} tries kept${br.trying ? ' · trying something new this year' : ''}
        · learned from neighbours ${br.copiedKept} of ${br.copied} times · daring ${Math.round(br.step * 100)}%.</p>
      ${br.reactsTo?.length ? `<p class="muted">It reacts most to: <b>${br.reactsTo.map(esc).join('</b>, <b>')}</b>.</p>` : ''}
      ${brainSvg(br as unknown as BrainNet)}
      <div class="barlist">${Object.entries(br.now).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="barrow"><span class="bl-k">${JOB_NAMES[k] ?? k}</span><span class="bl-v">×${v.toFixed(2)} now · ×${(br.weights[k] ?? 0).toFixed(2)} this year</span>
        <div class="bl-bar"><i style="width:${(v / max) * 100}%;background:${hex(b.color)}"></i></div></div>`).join('')}
        ${b.settled ? '' : `<div class="barrow"><span class="bl-k">Restlessness (moving on before they must)</span><span class="bl-v">${Math.round(br.roam * 100)}%</span>
        <div class="bl-bar"><i style="width:${br.roam * 100}%;background:var(--accent-2)"></i></div></div>`}
        <div class="barrow"><span class="bl-k">Generosity to friends</span><span class="bl-v">${Math.round(br.give * 100)}%</span>
        <div class="bl-bar"><i style="width:${br.give * 100}%;background:var(--good)"></i></div></div></div>`;
  }).catch(() => { const el = document.getElementById('bandBrain'); if (el) el.textContent = 'Could not load.'; });
  // friends and rivals, and everyone in the clan, each in one request
  api<{ id: number; name: string; color: number; score: number; kind: string }[]>(`/api/relations/${b.id}`).then((rs) => {
    const el = document.getElementById('bandRel');
    if (!el) return;
    const shown = rs.filter((x) => x.kind !== 'neutral').slice(0, 10);
    const label: Record<string, string> = { ally: 'ally', friendly: 'friendly', cool: 'cool', rival: 'rival' };
    el.classList.remove('muted');
    el.innerHTML = shown.length ? `<ul class="rels">${shown.map((x) => `<li data-band="${x.id}"><span class="dot" style="background:${hex(x.color)}"></span>
        <span class="rel-name">${esc(x.name)}</span><span class="rel ${x.kind}">${label[x.kind]}</span>
        <span class="rel-bar"><i style="width:${Math.abs(x.score) / 2}%;${x.score < 0 ? 'right:50%' : 'left:50%'}" class="${x.score < 0 ? 'neg' : 'pos'}"></i></span></li>`).join('')}</ul>`
      : '<p class="muted">No strong feelings for any neighbour yet.</p>';
  }).catch(() => { const el = document.getElementById('bandRel'); if (el) el.textContent = 'Could not load.'; });
  api<{ total: number; people: PersonListRow[] }>(`/api/people?band=${b.id}&sort=old&limit=200`).then((res) => {
    const el = document.getElementById('bandPeople');
    if (!el) return;
    el.innerHTML = res.people.map((p) => `<li data-person="${p.id}"><span class="avatar sm ${p.sex ? 'f' : 'm'}">${p.age < 12 ? '🧒' : p.age >= 60 ? (p.sex ? '👵' : '👴') : p.sex ? '👩' : '👨'}</span>
      <div><b>${esc(p.name)}</b>${p.chief ? ' <span class="badge village">chief</span>' : ''}<div class="muted">${p.age} y · ${esc(TASK(TASK_NAMES[p.task as keyof typeof TASK_NAMES] ?? p.task))}${p.deeds ? ` · ${p.deeds} deed${p.deeds > 1 ? 's' : ''}` : ''}</div></div></li>`).join('')
      || '<li class="muted">Nobody.</li>';
  }).catch(() => { const el = document.getElementById('bandPeople'); if (el) el.innerHTML = '<li class="muted">Could not load.</li>'; });
}

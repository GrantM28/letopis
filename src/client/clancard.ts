// The fork's part of the clan card: help aimed at the clan, its brain, its friends and rivals, and everyone in it.
// main.ts draws the card and calls fillBandCard(); each part loads on its own.
import type { BandView } from '../shared/types';
import { TASK_NAMES } from '../shared/types';
import { TASK } from './lang';
import { $, api, esc } from './kit';
import { useAct } from './help';
import { BrainNet, DeepNet, brainSvg, deepSvg } from './brainview';
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
  api<{ style: string; weights: Record<string, number>; now: Record<string, number>; give: number; generation: number; tried: number; kept: number; trying: boolean; inspired: boolean; reactsTo: string[]; network: string; roam: number; copied: number; copiedKept: number; step: number;
    brain2?: boolean; deep?: DeepNet | null; memory?: number[] | null; lastPeriod?: number | null;
    culture?: { id: number; name: string; steps: number; score: number; since: number; from: string | null; clans: { id: number; name: string }[] } | null } | null>(`/api/brain/${b.id}`).then((br) => {
    const el = document.getElementById('bandBrain');
    if (!el || !br) { if (el) el.textContent = 'Still finding its way.'; return; }
    el.classList.remove('muted');
    $('#bandStyleTag').textContent = br.style + (br.inspired ? ' · inspired' : '');
    const max = Math.max(...Object.values(br.now), ...Object.values(br.weights));
    const c = br.culture;
    const bold = br.step >= 0.15 ? 'bold' : br.step >= 0.06 ? 'steady' : 'careful';
    const intro = br.brain2 && c
      ? `<p class="lead">This clan belongs to the culture of <b>${esc(c.name)}</b>: ${c.clans.length} clan${c.clans.length === 1 ? '' : 's'} sharing one deep
        neural network (${esc(br.network)}). Every month it reads 18 senses (the season, hunger, stores, the land around, wood, children and elders,
        crowding, friends and rivals nearby, how the last two years went) and six memory cells it writes for itself, and decides how the clan
        shares its work, how generous it is and whether to move on.</p>
        <p class="muted">How the culture learns: all its clans live two years with one small change to the network, then two years with the opposite
        change, and the culture keeps moving the way that fed and grew its people better. A culture doing clearly worse than one nearby takes up
        part of its ways, and a culture grown too big splits in two.</p>
        <p class="muted">${c.steps} learning steps since ${c.since < 0 ? `${-c.since} BC` : `AD ${c.since}`}${c.from ? ` · split from the culture of ${esc(c.from)}` : ''}
        ${br.lastPeriod !== null && br.lastPeriod !== undefined ? ` · the culture did ${br.lastPeriod >= 0 ? 'better' : 'worse'} than in the two years before (${br.lastPeriod >= 0 ? '+' : ''}${br.lastPeriod.toFixed(2)})` : ''}.</p>
        ${c.clans.length > 1 ? `<p class="muted">Its clans: ${c.clans.slice(0, 14).map((x) => `<a href="#" class="ref" data-band="${x.id}">${esc(x.name)}</a>`).join(', ')}.</p>` : ''}`
      : `<p class="lead">This clan's brain is a small neural network: 11 senses (the season, hunger, food stores, the fruit, game and fish
        nearby, warmth, the clan's size, whether it is settled and the age of the world) feed 8 neurons, which decide each month how the clan shares
        its work between six jobs, how generous it is with friends and, while it wanders, whether to move on early.
        It learns by trial: it lives two years with a slightly changed copy of its network and keeps the copy only if the clan ate better and grew
        (people who left to found daughter clans count as growth). Now and then the copy is a blend with a neighbour that is doing better.</p>
        <p class="muted">Generation ${br.generation} of its line (each daughter clan is one more than the clan it split from)
        · ${br.kept} of ${br.tried} changes kept${br.copied ? ` · tried a neighbour's ways ${br.copied} time${br.copied === 1 ? '' : 's'}, kept ${br.copiedKept}` : ''}
        · its changes are ${bold} now (bigger while they work, smaller while they fail).</p>`;
    el.innerHTML = `${intro}
      ${br.reactsTo?.length ? `<p class="muted">It reacts most to: <b>${br.reactsTo.map(esc).join('</b>, <b>')}</b>.</p>` : ''}
      ${br.deep ? deepSvg(br.deep) : brainSvg(br as unknown as BrainNet)}
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

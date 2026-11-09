// The fork's powers and prayers: the Help button, its card and the prayer count on it.
import { fmtYear } from './lang';
import { $, api, esc, ui } from './kit';

// ---------- helping the world: a blessing, rain, a feast ----------

const ACT_INFO: Record<string, { icon: string; name: string; text: string; who: string }> = {
  bless: { icon: '🌟', name: 'Send a blessing', text: 'Food finds its way to the clan.', who: 'the hungriest clan' },
  rain: { icon: '🌧️', name: 'Send rain', text: 'A long warm rain over the land around the clan.', who: 'the driest land' },
  feast: { icon: '🍖', name: 'Call a feast', text: 'The clan invites its neighbours to a great feast.', who: 'the biggest clan' },
  inspire: { icon: '💭', name: 'Inspire an inventor', text: 'For two years the clan is four times as likely to discover something.', who: 'the biggest clan' },
  calm: { icon: '🕊️', name: 'Calm a feud', text: 'The clan makes peace with its rivals.', who: 'the clan with the most rivals' },
};
const WANT_TEXT: Record<string, string> = { bless: 'pray for food', rain: 'pray for rain', calm: 'pray for peace' };
type ActState = { kind: string; ready: boolean; readyIn: number; last: { at: number; band: string } | null };
type PrayerView = { id: number; band: number; name: string; color: number; want: string; year: number; fadesIn: number };
const mins = (ms: number) => (ms >= 3600000 ? `${Math.floor(ms / 3600000)} h ${Math.ceil((ms % 3600000) / 60000)} min` : `${Math.max(1, Math.ceil(ms / 60000))} min`);
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

/** one power: on a chosen clan, or (without one) where it is needed most */
export async function useAct(kind: string, band?: number): Promise<string> {
  const res = await fetch(`/api/act/${kind}${band ? `?band=${band}` : ''}`, { method: 'POST' }).then((x) => x.json()).catch(() => null) as
    { ok?: boolean; band?: string; bandId?: number; error?: string; readyIn?: number } | null;
  if (res?.ok && res.bandId) {
    const b = ui.bands().find((x) => x.id === res.bandId);
    if (b) { ui.focusBand(b); }
    return `Done: ${esc(res.band ?? '')} will remember it.`;
  }
  return res?.readyIn ? `Not yet: ready again in ${mins(res.readyIn)}.` : `Not now: ${esc(res?.error ?? 'the server did not answer')}.`;
}

async function showActs(note = '') {
  const data = await api<{ acts: ActState[]; prayers: PrayerView[] }>('/api/acts').catch(() => null);
  if (!data) return;
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  ui.openCard(`<h2>✨ Help the world</h2>
    <p class="muted">The world lives on its own, but now and then you may lend a hand. Each power waits a while before it can be used again
      (the same wait for everyone watching), and everything you do is written in the chronicle. To help one particular clan, open its card.</p>
    ${note ? `<p class="act-note">${note}</p>` : ''}
    <h3>Prayers <small>${data.prayers.length}</small></h3>
    ${data.prayers.length ? `<ul class="prayers">${data.prayers.map((p) => `<li>
        <span class="dot" style="background:${hex(p.color)}"></span>
        <span class="pr-body"><a href="#" class="ref" data-band="${p.band}">${esc(p.name)}</a> ${WANT_TEXT[p.want] ?? 'pray'}
          <small>since ${fmtYear(p.year)} · fades in ${mins(p.fadesIn)}</small></span>
        <button class="btn pr-answer" data-prayer="${p.id}">Answer</button></li>`).join('')}</ul>`
      : '<p class="muted">No clan is praying right now. Clans in trouble pray now and then: a hungry clan for food, a dry one for rain, a feuding one for peace.</p>'}
    <h3>Powers</h3>
    <div class="acts">${data.acts.map((a) => {
      const i = ACT_INFO[a.kind];
      if (!i) return '';
      return `<button class="act" data-act="${a.kind}" ${a.ready ? '' : 'disabled'}>
        <span class="act-icon">${i.icon}</span><span class="act-body"><b>${i.name}</b><small>${i.text} Goes to ${i.who}.</small>
        <small class="act-state">${a.ready ? 'Ready' : `Ready again in ${mins(a.readyIn)}`}${a.last ? ` · last: ${esc(a.last.band)}, ${ago(a.last.at)}` : ''}</small></span></button>`;
    }).join('')}</div>`);
  document.querySelectorAll<HTMLButtonElement>('#cardBody .act').forEach((btn) => {
    btn.onclick = async () => { btn.disabled = true; void showActs(await useAct(btn.dataset.act!)); };
  });
  document.querySelectorAll<HTMLButtonElement>('#cardBody .pr-answer').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      const res = await fetch(`/api/prayer/${btn.dataset.prayer}`, { method: 'POST' }).then((x) => x.json()).catch(() => null) as { ok?: boolean; band?: string; bandId?: number; error?: string } | null;
      if (res?.ok && res.bandId) { const b = ui.bands().find((x) => x.id === res.bandId); if (b) { ui.focusBand(b); } }
      void showActs(res?.ok ? `Your answer reached ${esc(res.band ?? '')}.` : `Too late: ${esc(res?.error ?? 'the server did not answer')}.`);
      void refreshPrayerBadge();
    };
  });
}

/** a small number on the Help button while clans are praying */
async function refreshPrayerBadge() {
  const data = await api<{ prayers: PrayerView[] }>('/api/acts').catch(() => null);
  const n = data?.prayers.length ?? 0;
  const btn = $('#actsBtn');
  let badge = btn.querySelector<HTMLElement>('.count');
  if (!badge) { badge = document.createElement('span'); badge.className = 'count'; btn.appendChild(badge); }
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

export function initHelp() {
  $('#actsBtn').onclick = () => void showActs();
  setInterval(() => void refreshPrayerBadge(), 30_000);
  void refreshPrayerBadge();
}

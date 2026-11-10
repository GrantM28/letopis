// One card for everything (1.60): every card (clan, culture, realm, person, discovery) is built the same way:
//   a header (a mark, the name, one line of facts), chips (links to its culture, realm, ...), at most four numbers, then
//   tabs that stay at the top while the card scrolls, or a plain body. The last tab chosen is remembered for each kind.
import { esc, save, store } from './kit';

export interface CardTab {
  id: string;
  label: string;
  /** fills the tab's panel (may load data first) */
  render: (panel: HTMLElement) => void | Promise<void>;
}

export interface CardSpec {
  /** which kind of card: remembers its last tab ('clan', 'culture', 'realm', ...) */
  kind: string;
  /** the mark left of the name: a colour (css) for a dot, or an emoji */
  dot?: string;
  emoji?: string;
  title: string;
  /** one line under the name (html) */
  facts?: string;
  /** small links under the header (html each) */
  chips?: string[];
  /** at most four [label, value] numbers (value is html) */
  stats?: [string, string][];
  tabs?: CardTab[];
  /** a body instead of tabs (html) */
  body?: string;
  /** a part of the How it works page to open from the "?" */
  help?: string;
}

/** a link chip: icon, words and what it opens (data-culture="3", ...) */
export const chip = (icon: string, label: string, ref = '') => `<${ref ? 'a href="#"' : 'span'} class="ck-chip" ${ref}>${icon ? `<span class="ck-chip-i">${icon}</span>` : ''}${label}</${ref ? 'a' : 'span'}>`;


/** the card's html; call `mountCard(spec)` after the card is open */
export function cardHtml(spec: CardSpec): string {
  const mark = spec.emoji ? `<div class="ck-mark ck-emoji">${spec.emoji}</div>` : spec.dot ? `<div class="ck-mark"><span class="ck-dot" style="background:${spec.dot}"></span></div>` : '';
  const stats = (spec.stats ?? []).slice(0, 4);
  return `
    <header class="ck-head">${mark}<div class="ck-name"><h2>${esc(spec.title)}</h2>${spec.facts ? `<div class="ck-facts">${spec.facts}</div>` : ''}</div>
      ${spec.help ? `<button class="btn round ck-help" data-help="${esc(spec.help)}" title="How this works" aria-label="How this works">?</button>` : ''}</header>
    ${spec.chips?.length ? `<div class="ck-chips">${spec.chips.join('')}</div>` : ''}
    ${stats.length ? `<div class="ck-stats ck-stats-${stats.length}">${stats.map(([k, v]) => `<div><b>${v}</b><span>${esc(k)}</span></div>`).join('')}</div>` : ''}
    ${spec.tabs?.length ? `<nav class="ck-tabs" role="tablist">${spec.tabs.map((t) => `<button role="tab" class="ck-tab" data-cktab="${t.id}">${esc(t.label)}</button>`).join('')}</nav><div class="ck-panel" role="tabpanel"></div>` : ''}
    ${spec.body ? `<div class="ck-body">${spec.body}</div>` : ''}`;
}

/** wire the tabs of the open card and show the remembered (or first) one */
export function mountCard(spec: CardSpec, root: ParentNode = document) {
  if (!spec.tabs?.length) return;
  const panel = root.querySelector<HTMLElement>('.ck-panel');
  if (!panel) return;
  const show = (id: string) => {
    const tab = spec.tabs!.find((t) => t.id === id) ?? spec.tabs![0];
    save(`letopis.cardtab.${spec.kind}`, tab.id);
    root.querySelectorAll<HTMLButtonElement>('.ck-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.cktab === tab.id)));
    // each choice draws into a fresh holder in the card (charts measure their width); a slow tab that finishes after
    // another was chosen draws into a holder that is no longer there
    const holder = document.createElement('div');
    holder.innerHTML = '<p class="muted">Loading…</p>';
    panel.replaceChildren(holder);
    void Promise.resolve(tab.render(holder)).catch(() => { holder.innerHTML = '<p class="muted">Could not load this. Try again in a moment.</p>'; });
  };
  root.querySelectorAll<HTMLButtonElement>('.ck-tab').forEach((b) => { b.onclick = () => show(b.dataset.cktab!); });
  show(store(`letopis.cardtab.${spec.kind}`, spec.tabs[0].id));
}

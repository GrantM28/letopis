// Tells the outside world about the great moments: a new age, a first discovery, a wonder, the end of a world.
//   LETOPIS_WEBHOOK_URL  POST JSON { title, message, kind, importance, year, world } (Home Assistant webhook, Discord-like relays, n8n...)
//   LETOPIS_NTFY_URL     POST plain text with a Title header (ntfy.sh/<topic> or your own ntfy server): a phone push
//   LETOPIS_NOTIFY_MIN   the least importance sent (1..3, default 3: only the greatest moments)
// Nothing is sent when neither URL is set.

import type { ChronicleEntry } from '../shared/types';
import { formatYearEn } from '../shared/i18n';

const WEBHOOK = (process.env.LETOPIS_WEBHOOK_URL ?? '').trim();
const NTFY = (process.env.LETOPIS_NTFY_URL ?? '').trim();
const MIN = Math.max(1, Math.min(3, Number(process.env.LETOPIS_NOTIFY_MIN ?? 3) || 3));
/** a few short messages a minute at most, so a fast test world cannot flood a phone */
const MAX_PER_MINUTE = 4;

export const notifyEnabled = !!(WEBHOOK || NTFY);

const TITLES: Record<string, string> = {
  era: 'A new age begins', discovery: 'A first discovery', wonder: 'A great building', plague: 'A plague',
  milestone: 'The world grows', extinct: 'A clan has died out', end: 'The world has ended', comet: 'A sign in the sky',
  quake: 'An earthquake', blessing: 'A blessing', rain: 'Rain', feast: 'A feast',
};

let sentAt: number[] = [];
let held = 0;

export function notify(events: ChronicleEntry[], world: string) {
  if (!notifyEnabled) return;
  // only first discoveries, never the rediscoveries
  const big = events.filter((e) => e.importance >= MIN && e.kind !== 'rediscovery');
  if (!big.length) return;
  const now = Date.now();
  sentAt = sentAt.filter((t) => now - t < 60_000);
  for (const e of big) {
    if (sentAt.length >= MAX_PER_MINUTE) { held++; continue; }
    sentAt.push(now);
    const text = e.en?.text ?? e.text;
    // plain ASCII: it also travels as an HTTP header to ntfy
    const title = `${TITLES[e.kind] ?? 'Letopis'} - ${formatYearEn(Math.floor(e.year))}`;
    const message = held ? `${text} (+${held} more while it was busy)` : text;
    held = 0;
    if (WEBHOOK) post(WEBHOOK, JSON.stringify({ title, message, kind: e.kind, importance: e.importance, year: Math.floor(e.year), world }),
      { 'content-type': 'application/json' });
    if (NTFY) post(NTFY, message, { title, tags: e.kind === 'era' ? 'star' : e.kind === 'discovery' ? 'bulb' : 'scroll', 'content-type': 'text/plain; charset=utf-8' });
  }
}

function post(url: string, body: string, headers: Record<string, string>) {
  // never let a slow or broken receiver hold up the world
  fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(8000) })
    .then((r) => { if (!r.ok) console.log(new Date().toISOString(), `notify ${r.status} from ${new URL(url).host}`); })
    .catch((e) => console.log(new Date().toISOString(), `notify failed: ${e?.message ?? e}`));
}

// The AI storyteller (optional): Claude speaks for the people of the world and writes its legend.
//   ANTHROPIC_API_KEY      turns it on (without it the game runs exactly as before and nothing is sent anywhere)
//   LETOPIS_AI_MODEL       the model, default claude-opus-5-5
//   LETOPIS_AI_PER_HOUR    how many requests an hour at most, for everyone together (default 60), to keep the bill small
//
//   POST /api/ai/talk   { person, history: [{ who: 'you' | 'them', text }], message }  -> { reply }
//   POST /api/ai/legend                                                                 -> { text, upTo }
//   GET  /api/ai                                                                        -> { enabled, model, left }
//
// Everything the model is told comes from the simulation: the person's life, family, deeds, clan, age and what
// the chronicle wrote about them. It answers in character and knows only what its age knows.

import Anthropic from '@anthropic-ai/sdk';
import type http from 'node:http';
import type { Simulation } from './sim/sim';
import type { Store } from './db';
import type { Extras } from './extras';
import { ERAS_EN, GENE_EN, TECH_EN, deedEn, formatYearEn, personEn, taskEn, titleEn } from '../shared/i18n';
import { brainView } from './sim/brain';

const KEY = (process.env.ANTHROPIC_API_KEY ?? '').trim();
const MODEL = (process.env.LETOPIS_AI_MODEL ?? '').trim() || 'claude-opus-5-5';
const PER_HOUR = Math.max(1, Number(process.env.LETOPIS_AI_PER_HOUR ?? 60) || 60);

export const aiEnabled = !!KEY;
const client = aiEnabled ? new Anthropic({ apiKey: KEY }) : null;

let calls: number[] = [];
function budgetLeft(): number {
  const now = Date.now();
  calls = calls.filter((t) => now - t < 3600_000);
  return PER_HOUR - calls.length;
}

type Json = (res: http.ServerResponse, data: unknown, status?: number) => void;

function readBody(req: http.IncomingMessage, max = 20_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > max) { reject(new Error('too long')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/** one request to Claude: the text of the answer, or why there is none */
async function ask(system: string, messages: Anthropic.Beta.BetaMessageParam[], effort: 'low' | 'medium', maxTokens: number): Promise<{ text: string } | { error: string }> {
  if (!client) return { error: 'The storyteller is off: set ANTHROPIC_API_KEY on the server to wake it.' };
  if (budgetLeft() <= 0) return { error: 'The storyteller is resting: the hourly limit is reached. Try again later.' };
  calls.push(Date.now());
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      // if the model declines, the API tries a fallback model inside the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      system,
      messages,
    });
    if (response.stop_reason === 'refusal') return { error: 'They would rather not speak of that.' };
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return text ? { text } : { error: 'No answer came.' };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'The storyteller could not sign in: check ANTHROPIC_API_KEY.' };
    if (e instanceof Anthropic.RateLimitError) return { error: 'The storyteller is busy right now. Try again in a minute.' };
    if (e instanceof Anthropic.BadRequestError) { console.log(new Date().toISOString(), 'AI bad request', e.message); return { error: 'The storyteller did not understand the request.' }; }
    if (e instanceof Anthropic.APIError) { console.log(new Date().toISOString(), 'AI error', e.status, e.message); return { error: 'The storyteller could not answer right now.' }; }
    console.log(new Date().toISOString(), 'AI failure', e);
    return { error: 'The storyteller could not be reached.' };
  }
}

/** what a person knows about their own life, in English, from the simulation */
function personContext(sim: Simulation, store: Store, id: number): { name: string; text: string } | null {
  const d = sim.personDetail(id);
  if (!d || d.diedYear !== null) return null;
  const p = sim.s.people.find((x) => x.id === id);
  const b = p ? sim.s.bands.find((x) => x.id === p.bandId) : undefined;
  if (!p || !b) return null;
  const year = Math.floor(sim.year);
  const era = ERAS_EN[sim.s.era] ?? 'Stone Age';
  const name = personEn(d.name);
  const fam = (x: { name: string } | null) => (x ? personEn(x.name) : 'unknown (one of the first people)');
  const brain = brainView(sim as never, b);
  const knows = b.techs.map((t) => TECH_EN[t]?.name ?? t);
  // what the chronicle wrote lately about them and their clan
  const told = store.chronicle(sim.s.worldId, { limit: 400 })
    .filter((e) => e.personId === id || e.bandId === b.id)
    .slice(0, 14).reverse()
    .map((e) => `- ${formatYearEn(Math.floor(e.year))}: ${e.en?.text ?? ''}`).filter((l) => !l.endsWith(': '));
  const genes = Object.entries(d.genes).map(([k, v]) => `${GENE_EN[k] ?? k} ${v}/100`).join(', ');
  const text = [
    `You are ${name}, ${d.sex ? 'a woman' : 'a man'} of ${d.age}, living in the year ${formatYearEn(year)}, in the ${era}.`,
    `Your clan: ${sim.bandEnLabel(b, true)} (${sim.s.people.filter((x) => x.bandId === b.id).length} people, ${b.settled ? 'settled in a village' : 'wandering the land'}).`,
    d.title ? `You are ${titleEn(d.title)}.` : '',
    `Right now you are ${taskEn(d.task)}.`,
    `Mother: ${fam(d.mother)}. Father: ${fam(d.father)}. Partner: ${d.partner ? personEn(d.partner.name) : 'none'}.`,
    `Children: ${d.children.length ? d.children.map((c) => `${personEn(c.name)}${c.alive ? '' : ' (passed away)'}`).join(', ') : 'none'}.`,
    `Generation ${d.generation} since the first people. Your nature: ${genes}.`,
    d.deeds.length ? `What you have done: ${d.deeds.map(deedEn).join('; ')}.` : 'You have done nothing the chronicle remembers yet.',
    `What your clan knows: ${knows.length ? knows.join(', ') : 'nothing yet beyond what the hands remember'}.`,
    brain ? `Your clan lives as ${brain.style.toLowerCase()}.` : '',
    told.length ? `Recent things that happened to you and your clan:\n${told.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return { name, text };
}

const TALK_RULES = `You are a person in Letopis, a world that lives on its own, talking with a visitor who watches the world from above.
Stay in character the whole time. Speak in plain, warm English, the way someone of your age and time would, in 1 to 4 short sentences.
You know only what your clan and your age know: never mention things not yet discovered, numbers like "generation 3" or "70/100",
games, simulations or AI. If asked about something you cannot know, wonder about it the way your people would.
You may be curious about the visitor; some think they are a spirit or a god. Never describe violence in detail.`;

const LEGEND_RULES = `You are the chronicler of Letopis, a world that grows from the Stone Age on its own.
From the chronicle entries you are given, write the legend of this world so far: 4 to 7 short paragraphs, oldest first, in warm,
simple English, as a storyteller would tell it by the fire. Name the people and clans the entries name, tie events together into a story,
and end with the world as it is now. Use only what the entries say; do not invent discoveries, wars or numbers. No headings, no lists.`;

export async function handleAi(req: http.IncomingMessage, res: http.ServerResponse, p: string, sim: Simulation, store: Store, extras: Extras, json: Json): Promise<boolean> {
  if (p === '/api/ai') { json(res, { enabled: aiEnabled, model: aiEnabled ? MODEL : null, left: aiEnabled ? budgetLeft() : 0 }); return true; }
  if (p === '/api/ai/talk' && req.method === 'POST') {
    const body = await readBody(req).catch(() => null) as { person?: number; history?: { who: string; text: string }[]; message?: string } | null;
    const message = String(body?.message ?? '').trim().slice(0, 600);
    if (!body?.person || !message) { json(res, { error: 'Say something first.' }, 400); return true; }
    const ctx = personContext(sim, store, Number(body.person));
    if (!ctx) { json(res, { error: 'That person is no longer among the living.' }, 404); return true; }
    // the conversation so far (the page keeps it), alternating and starting with the visitor
    const history: Anthropic.Beta.BetaMessageParam[] = [];
    for (const h of (body.history ?? []).slice(-12)) {
      const role = h.who === 'them' ? 'assistant' : 'user';
      const text = String(h.text ?? '').slice(0, 1200);
      if (!text || (!history.length && role !== 'user')) continue;
      const last = history[history.length - 1];
      if (last && last.role === role) last.content = `${last.content as string}\n${text}`;
      else history.push({ role, content: text });
    }
    if (history.length && history[history.length - 1].role === 'user') history.pop();
    history.push({ role: 'user', content: message });
    const r = await ask(`${TALK_RULES}\n\n${ctx.text}`, history, 'low', 1500);
    json(res, 'text' in r ? { reply: r.text, name: ctx.name } : { error: r.error }, 'text' in r ? 200 : 503);
    return true;
  }
  if (p === '/api/ai/legend' && req.method === 'POST') {
    const w = sim.s.worldId;
    // the great moments (kept for ever) and the latest important ones
    const great = store.chronicle(w, { min: 3, limit: 500 }).reverse();
    const lately = store.chronicle(w, { min: 2, limit: 60 }).reverse();
    const seen = new Set<number>();
    const lines = [...great, ...lately].sort((a, b) => a.id - b.id).filter((e) => !seen.has(e.id) && seen.add(e.id))
      .map((e) => `${formatYearEn(Math.floor(e.year))}: ${e.en?.text ?? ''}`).filter((l) => !l.endsWith(': '));
    if (!lines.length) { json(res, { error: 'Nothing has happened yet that a legend could tell.' }, 404); return true; }
    const upTo = Math.max(...[...great, ...lately].map((e) => e.id));
    // the same history gives the same legend: keep it until something new and important happens
    const cached = extras.getSetting<{ world: string; upTo: number; text: string } | null>('legend', null);
    if (cached && cached.world === w && cached.upTo === upTo) { json(res, { text: cached.text, upTo, cached: true }); return true; }
    const now = `The world now: year ${formatYearEn(Math.floor(sim.year))}, the ${ERAS_EN[sim.s.era]}, ${sim.s.people.length} people in ${sim.s.bands.length} clans.`;
    const r = await ask(LEGEND_RULES, [{ role: 'user', content: `${now}\n\nThe chronicle:\n${lines.slice(-260).join('\n')}` }], 'medium', 6000);
    if ('text' in r) { extras.setSetting('legend', { world: w, upTo, text: r.text }); json(res, { text: r.text, upTo }); } else json(res, { error: r.error }, 503);
    return true;
  }
  return false;
}


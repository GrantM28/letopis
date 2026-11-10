// The dead the chronicle lets go: only people with no children, no deeds and no partner, who died over 300 years ago.
// Everyone who can appear in a family tree or a story stays.
import { DatabaseSync } from 'node:sqlite';
import { Extras } from '../src/server/extras';

export function forget() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE dead (world TEXT NOT NULL, id INTEGER NOT NULL, json TEXT, PRIMARY KEY (world, id))');
  const ex = new Extras(db);
  const add = (id: number, died: number, extra: Record<string, unknown> = {}, world = 'w') =>
    db.prepare('INSERT INTO dead VALUES (?,?,?)').run(world, id, JSON.stringify({ id, died, children: [], deeds: [], partnerId: null, ...extra }));
  const now = 10000;
  add(1, 100);                          // long ago, nothing: let go
  add(2, 100, { children: [7] });       // a parent: an ancestor, stays
  add(3, 100, { deeds: ['x'] });        // did something: stays
  add(4, 100, { partnerId: 9 });        // someone's partner: stays
  add(6, 100, {}, 'other');             // another world: not touched
  add(8, 120);                          // long ago, nothing: let go
  add(5, now - 100);                    // died lately: stays for now (the dead are stored in the order they died)
  for (let i = 0; i < 5; i++) (ex as unknown as { forgetDead(w: string, t: number): void }).forgetDead('w', now);
  const left = (db.prepare("SELECT world || ':' || id AS k FROM dead ORDER BY rowid").all() as { k: string }[]).map((r) => r.k).join(' ');
  if (left !== 'w:2 w:3 w:4 other:6 w:5') throw new Error(`left after forgetting: ${left}`);
}

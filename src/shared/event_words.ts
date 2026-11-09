// Words the world events write into people's deeds, in both languages (used by the server and the page).

/** a great building of the age, by era: [bg, en] */
export const WONDERS: Record<number, [string, string][]> = {
  2: [['каменен храм на хълма', 'a stone temple on the hill'], ['зикурат от печени тухли', 'a ziggurat of fired brick']],
  3: [['амфитеатър за хиляда души', 'an amphitheatre for a thousand people'], ['голяма библиотека', 'a great library'], ['каменен мост над реката', 'a stone bridge over the river']],
  4: [['катедрала с цветни стъкла', 'a cathedral with stained glass'], ['манастир с книжовна школа', 'a monastery with a school of letters'], ['каменна кула с часовник', 'a stone clock tower']],
  5: [['обсерватория', 'an observatory'], ['голям пазарен площад', 'a great market square'], ['пристанище за океански кораби', 'a harbour for ocean ships']],
  6: [['гара от стъкло и желязо', 'a railway station of glass and iron'], ['музей', 'a museum'], ['голям завод', 'a great factory']],
  7: [['кула с антени', 'a tower full of antennas'], ['стадион', 'a stadium'], ['болница', 'a modern hospital']],
  8: [['космодрум', 'a spaceport'], ['градина под купол', 'a garden under a dome']],
};

/** where an expedition goes, by the age: [bg, en] */
export function expeditionWhere(era: number): [string, string] {
  return era >= 8 ? ['към пръстените на Сатурн', 'to the rings of Saturn'] : era >= 7 ? ['до дъното на океана', 'to the bottom of the ocean']
    : era >= 5 ? ['отвъд океана', 'across the ocean'] : ['през планините на изток', 'over the mountains to the east'];
}

/** the deeds of the world events in English */
export function eventDeedEn(d: string): string | null {
  if (d === 'Устрои голям празник') return 'Held a great festival';
  if (d === 'Посрещна съседите на голям пир') return 'Hosted the neighbours at a great feast';
  if (d === 'Сънува сън, пълен с идеи') return 'Dreamed a dream full of ideas';
  let m: RegExpExecArray | null;
  if ((m = /^Построи (.+)$/.exec(d))) {
    for (const list of Object.values(WONDERS)) for (const [bg, en] of list) if (bg === m[1]) return `Built ${en}`;
  }
  if ((m = /^Поведе експедиция (.+)$/.exec(d))) {
    for (const era of [3, 5, 7, 8]) { const [bg, en] = expeditionWhere(era); if (bg === m[1]) return `Led an expedition ${en}`; }
  }
  return null;
}

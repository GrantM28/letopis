import { Rng } from '../../shared/rng';

// Bulgarian personal names. Old Slavic/Bulgarian names fit the early eras, so they are weighted early on.
export const MALE = [
  'Иван', 'Петър', 'Георги', 'Димитър', 'Стоян', 'Тодор', 'Никола', 'Христо', 'Васил', 'Атанас',
  'Добри', 'Драган', 'Радослав', 'Светослав', 'Боян', 'Борис', 'Крум', 'Асен', 'Калоян', 'Пресиян',
  'Здравко', 'Велко', 'Радко', 'Божидар', 'Любомир', 'Мирослав', 'Огнян', 'Пламен', 'Камен', 'Страхил',
  'Волен', 'Благой', 'Добромир', 'Ивайло', 'Тервел', 'Румен', 'Цветан', 'Младен', 'Стефан', 'Ангел',
  'Станимир', 'Велислав', 'Траян', 'Златан', 'Бранимир', 'Деян', 'Неделчо', 'Сабин', 'Юлиан', 'Орлин',
];
export const FEMALE = [
  'Мария', 'Елена', 'Йорданка', 'Радка', 'Стояна', 'Цветана', 'Донка', 'Милка', 'Гергана', 'Райна',
  'Добрина', 'Светла', 'Вела', 'Злата', 'Калина', 'Неда', 'Румяна', 'Здравка', 'Божана', 'Мила',
  'Велика', 'Тодора', 'Росица', 'Пенка', 'Яна', 'Деница', 'Веселина', 'Лиляна', 'Бояна', 'Ружа',
  'Сияна', 'Искра', 'Огняна', 'Стана', 'Невена', 'Станка', 'Живка', 'Дена', 'Мирослава', 'Ралица',
  'Теодора', 'Кремена', 'Гана', 'Василка', 'Илина', 'Боряна', 'Ваня', 'Звезделина', 'Слава', 'Елица',
];

const NICK_M: Record<string, string[]> = {
  str: ['Силния', 'Мечката', 'Каменния', 'Яката ръка'],
  int: ['Мъдрия', 'Хитрия', 'Умника', 'Знаещия'],
  cur: ['Любопитния', 'Скитника', 'Търсача', 'Будния'],
  soc: ['Добрия', 'Веселия', 'Разказвача', 'Миротвореца'],
  hea: ['Здравия', 'Дъба', 'Неуморния'],
  none: ['Тихия', 'Високия', 'Рижавия', 'Бързия', 'Малкия', 'Черния'],
};
const NICK_F: Record<string, string[]> = {
  str: ['Силната', 'Мечката', 'Яката'],
  int: ['Мъдрата', 'Хитрата', 'Знаещата', 'Билкарката'],
  cur: ['Любопитната', 'Скитницата', 'Търсачката', 'Будната'],
  soc: ['Добрата', 'Веселата', 'Песнопойката'],
  hea: ['Здравата', 'Неуморната'],
  none: ['Тихата', 'Високата', 'Рижавата', 'Бързата', 'Малката', 'Черната'],
};

export function nickname(rng: Rng, female: boolean, topGene: string | null): string {
  const set = female ? NICK_F : NICK_M;
  return rng.pick(set[topGene ?? 'none'] ?? set.none);
}

/** Patronymic / family name from the father's first name: Иван -> Иванов / Иванова. */
export function familyFrom(fatherName: string, female: boolean): string {
  let base = fatherName;
  let suffix = 'ов';
  const last = base.slice(-1);
  if (last === 'а' || last === 'я') base = base.slice(0, -1);
  if (base.endsWith('й')) { base = base.slice(0, -1); suffix = 'ев'; }
  else if (/[жчшщцj]$/.test(base) || base.endsWith('ьо')) suffix = 'ев';
  else if (last === 'о' || last === 'е' || last === 'и') { base = base.slice(0, -1); suffix = 'ев'; }
  return base + suffix + (female ? 'а' : '');
}

// Place names: Bulgarian-sounding roots and endings.
const ROOTS = [
  'Бял', 'Черн', 'Камен', 'Дъбр', 'Бор', 'Студен', 'Рос', 'Горн', 'Долн', 'Брез', 'Вод', 'Яв', 'Липн',
  'Стрем', 'Злат', 'Сребр', 'Лесков', 'Глог', 'Осен', 'Бук', 'Мечк', 'Вълч', 'Орл', 'Соколн', 'Елов',
  'Тихо', 'Бистр', 'Мокр', 'Сух', 'Равн', 'Крив', 'Стар', 'Нов', 'Скал', 'Пещер', 'Връх', 'Мед', 'Бърд',
];
const PLACE_END = ['ово', 'ево', 'ец', 'ица', 'ище', 'ен', 'ина', 'ешница', 'анско', 'еница', 'овица', 'ата'];

export function placeName(rng: Rng, used: Set<string>): string {
  for (let k = 0; k < 50; k++) {
    let root = rng.pick(ROOTS);
    const end = rng.pick(PLACE_END);
    if (/[аеиоуъюя]$/.test(root) && /^[аеиоуъюя]/.test(end)) root = root.slice(0, -1);
    let name = root + end;
    if (rng.chance(0.12)) name = (rng.chance(0.5) ? 'Горно ' : 'Долно ') + name.replace(/(ец|ен)$/, 'ово');
    if (!used.has(name)) { used.add(name); return name; }
  }
  const fallback = rng.pick(ROOTS) + 'ово ' + used.size;
  used.add(fallback);
  return fallback;
}

const TOTEM = [
  'Мечката', 'Вълка', 'Орела', 'Елена', 'Сокола', 'Глигана', 'Бизона', 'Лисицата', 'Бухала', 'Рибата',
  'Дъба', 'Реката', 'Камъка', 'Огъня', 'Звездата', 'Луната', 'Слънцето', 'Вятъра', 'Гарвана', 'Риса',
];

export function bandName(rng: Rng, used: Set<string>): string {
  for (let k = 0; k < 40; k++) {
    const name = `Родът на ${rng.pick(TOTEM)}`;
    if (!used.has(name)) { used.add(name); return name; }
  }
  const n = `Родът на ${rng.pick(TOTEM)} ${used.size}`;
  used.add(n);
  return n;
}

const BAND_COLORS = [0xd9534f, 0x5bc0de, 0xf0ad4e, 0x5cb85c, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xe84393, 0x34495e, 0xc0a16b, 0x16a085, 0x8e44ad, 0xd35400, 0x2980b9];
export function bandColor(rng: Rng): number {
  return rng.pick(BAND_COLORS);
}

// English for Letopis. The world speaks Bulgarian inside the simulation; everything a player reads can also be shown in English.
// Names are transliterated (Иван Петров -> Ivan Petrov), nicknames, totems and places are translated.

export type Lang = 'bg' | 'en';

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};

/** Bulgarian streamlined transliteration */
export function translit(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const low = c.toLowerCase();
    const t = TR[low];
    if (t === undefined) { out += c; continue; }
    // "-ия" at the end of a word is written -ia (Мария -> Maria)
    if (low === 'я' && s[i - 1]?.toLowerCase() === 'и' && !/[а-я]/i.test(s[i + 1] ?? '')) { out += c === low ? 'a' : 'A'; continue; }
    out += c === low ? t : t[0].toUpperCase() + t.slice(1);
  }
  return out;
}

const NICK_EN: Record<string, string> = {
  'Яката ръка': 'Strongarm',
  Силния: 'the Strong', Мечката: 'the Bear', Каменния: 'the Stone', Мъдрия: 'the Wise', Хитрия: 'the Cunning', Умника: 'the Clever',
  Знаещия: 'the Knowing', Любопитния: 'the Curious', Скитника: 'the Wanderer', Търсача: 'the Seeker', Будния: 'the Watchful',
  Добрия: 'the Kind', Веселия: 'the Merry', Разказвача: 'the Storyteller', Миротвореца: 'the Peacemaker', Здравия: 'the Hale',
  Дъба: 'the Oak', Неуморния: 'the Tireless', Тихия: 'the Quiet', Високия: 'the Tall', Рижавия: 'the Red', Бързия: 'the Swift',
  Малкия: 'the Little', Черния: 'the Dark',
  Силната: 'the Strong', Яката: 'the Sturdy', Мъдрата: 'the Wise', Хитрата: 'the Cunning', Знаещата: 'the Knowing', Билкарката: 'the Herbalist',
  Любопитната: 'the Curious', Скитницата: 'the Wanderer', Търсачката: 'the Seeker', Будната: 'the Watchful', Добрата: 'the Kind',
  Веселата: 'the Merry', Песнопойката: 'the Songstress', Здравата: 'the Hale', Неуморната: 'the Tireless', Тихата: 'the Quiet',
  Високата: 'the Tall', Рижавата: 'the Red', Бързата: 'the Swift', Малката: 'the Little', Черната: 'the Dark',
};

/** "Иван Мъдрия" -> "Ivan the Wise", "Мария Петрова" -> "Maria Petrova" */
export function personEn(name: string): string {
  if (!name) return name;
  const multi = NICK_EN['Яката ръка'];
  let rest = name.replace('Яката ръка', '\u0001');
  rest = rest.split(' ').map((w) => (w === '\u0001' ? multi : NICK_EN[w] ?? translit(w))).join(' ');
  return rest;
}

// totems, adjectives and places of band names, by their dictionary form and with the article
const WORDS: [string, string][] = [
  ['Вълк', 'Wolf'], ['Орел', 'Eagle'], ['Орела', 'Eagle'], ['Елен', 'Stag'], ['Сокол', 'Falcon'], ['Глиган', 'Boar'], ['Бизон', 'Bison'],
  ['Бухал', 'Eagle-Owl'], ['Дъб', 'Oak'], ['Камък', 'Stone'], ['Камъка', 'Stone'], ['Огън', 'Fire'], ['Огъня', 'Fire'], ['Вятър', 'Wind'], ['Вятъра', 'Wind'],
  ['Гарван', 'Raven'], ['Рис', 'Lynx'], ['Бобър', 'Beaver'], ['Бобъра', 'Beaver'], ['Кон', 'Horse'], ['Коня', 'Horse'], ['Ястреб', 'Hawk'], ['Бор', 'Pine'],
  ['Облак', 'Cloud'], ['Лъв', 'Lion'], ['Щъркел', 'Stork'], ['Мамут', 'Mammoth'], ['Тур', 'Aurochs'], ['Зубър', 'Wisent'], ['Зубъра', 'Wisent'],
  ['Гром', 'Thunder'], ['Кремък', 'Flint'], ['Кремъка', 'Flint'], ['Вихър', 'Whirlwind'], ['Вихъра', 'Whirlwind'], ['Здрач', 'Dusk'], ['Изгрев', 'Sunrise'],
  ['Залез', 'Sunset'], ['Ручей', 'Brook'], ['Ручея', 'Brook'], ['Руче', 'Brook'], ['Водопад', 'Waterfall'], ['Лебед', 'Swan'], ['Жерав', 'Crane'],
  ['Таралеж', 'Hedgehog'], ['Козирог', 'Ibex'], ['Скорпион', 'Scorpion'], ['Кълвач', 'Woodpecker'], ['Чинар', 'Plane Tree'], ['Явор', 'Sycamore'], ['Бръшлян', 'Ivy'],
  ['Мечка', 'Bear'], ['Лисица', 'Fox'], ['Риба', 'Fish'], ['Река', 'River'], ['Звезда', 'Star'], ['Луна', 'Moon'], ['Сърна', 'Doe'], ['Сова', 'Owl'],
  ['Змия', 'Serpent'], ['Пчела', 'Bee'], ['Скала', 'Cliff'], ['Планина', 'Mountain'], ['Роса', 'Dew'], ['Гора', 'Forest'], ['Зорница', 'Morning Star'],
  ['Лястовица', 'Swallow'], ['Мълния', 'Lightning'], ['Кошута', 'Hind'], ['Вълчица', 'She-Wolf'], ['Чапла', 'Heron'], ['Пеперуда', 'Butterfly'],
  ['Върба', 'Willow'], ['Липа', 'Linden'], ['Буря', 'Storm'], ['Зора', 'Dawn'], ['Дъга', 'Rainbow'], ['Мравка', 'Ant'], ['Видра', 'Otter'],
  ['Катерица', 'Squirrel'], ['Костенурка', 'Tortoise'], ['Калинка', 'Ladybird'], ['Сойка', 'Jay'], ['Кукумявка', 'Little Owl'],
  ['Слънцето', 'Sun'], ['Езерото', 'Lake'], ['Еленчето', 'Fawn'], ['Пламъчето', 'Little Flame'], ['Ехото', 'Echo'], ['Огнището', 'Hearth'],
  ['Небето', 'Sky'], ['Сърцето', 'Heart'],
  ['Хълм', 'Hill'], ['Брод', 'Ford'], ['Извор', 'Spring'], ['Бряг', 'Shore'], ['Дол', 'Dale'], ['Кладенец', 'Well'], ['Проход', 'Pass'],
  ['Долина', 'Valley'], ['Пещера', 'Cave'], ['Поляна', 'Meadow'], ['Падина', 'Hollow'], ['Могила', 'Mound'], ['Степ', 'Steppe'],
];
const ADJ: [string, string, string][] = [
  ['Белия', 'Бялата', 'White'], ['Сивия', 'Сивата', 'Grey'], ['Черния', 'Черната', 'Black'], ['Червения', 'Червената', 'Red'],
  ['Златния', 'Златната', 'Golden'], ['Стария', 'Старата', 'Old'], ['Бързия', 'Бързата', 'Swift'], ['Тихия', 'Тихата', 'Quiet'],
  ['Големия', 'Голямата', 'Great'], ['Малкия', 'Малката', 'Little'], ['Мъдрия', 'Мъдрата', 'Wise'], ['Самотния', 'Самотната', 'Lonely'],
  ['Северния', 'Северната', 'Northern'], ['Южния', 'Южната', 'Southern'], ['Сребърния', 'Сребърната', 'Silver'], ['Огнения', 'Огнената', 'Fiery'],
  ['Ледения', 'Ледената', 'Icy'], ['Звездния', 'Звездната', 'Starry'], ['Нощния', 'Нощната', 'Night'], ['Утринния', 'Утринната', 'Morning'],
  ['Буйния', 'Буйната', 'Unruly'], ['Каменния', 'Каменната', 'Stone'], ['Небесния', 'Небесната', 'Heavenly'], ['Дивия', 'Дивата', 'Wild'],
  ['Пеещия', 'Пеещата', 'Singing'], ['Шепнещия', 'Шепнещата', 'Whispering'], ['Синия', 'Синята', 'Blue'], ['Ранения', 'Ранената', 'Wounded'],
];
const WORD_EN = new Map<string, string>(WORDS);
for (const [m, f, en] of ADJ) { WORD_EN.set(m, en); WORD_EN.set(f, en); }

function wordEn(w: string): string {
  return WORD_EN.get(w) ?? WORD_EN.get(w.slice(0, -1)) ?? WORD_EN.get(w.slice(0, -2)) ?? translit(w);
}
const phraseEn = (s: string) => s.split(' ').map(wordEn).join(' ');

/** "Родът на Вълка от Ледения Хълм" -> "Clan of the Wolf from the Icy Hill" */
export function bandEn(name: string): string {
  const m = /^(?:Родът|рода) на (.+)$/.exec(name);
  if (!m) return translit(name);
  const [totem, place] = m[1].split(' от ');
  return `Clan of the ${phraseEn(totem)}${place ? ` from the ${phraseEn(place)}` : ''}`;
}

/** how a band is named inside an English sentence: "the Clan of the Wolf", "the village of Belovo" */
export function bandLabelEn(name: string, settlement: string | null | undefined, subject = false): string {
  const the = subject ? 'The' : 'the';
  return settlement ? `${the} village of ${translit(settlement)}` : `${the} ${bandEn(name)}`;
}

/** any band text the server writes in Bulgarian: "Родът на ...", "рода на ...", "Селото X", a village name */
export function bandTextEn(s: string): string {
  if (!s) return s;
  if (/^(Родът|рода) на /.test(s)) return (s[0] === 'Р' ? 'The ' : 'the ') + bandEn(s);
  const v = /^(Селото|селото) (.+)$/.exec(s);
  if (v) return `${v[1][0] === 'С' ? 'The' : 'the'} village of ${translit(v[2])}`;
  return translit(s);
}

export const TECH_EN: Record<string, { name: string; text: string; kids: string }> = {
  fire: { name: 'Fire', text: '{name} of {band} tamed fire. The nights are no longer so cold and frightening.', kids: '{name} lit the first fire! Now people keep warm and cook their food.' },
  stone_tools: { name: 'Stone Tools', text: '{name} of {band} learned to knap flint into sharp blades.', kids: '{name} made a knife of stone. Cutting is so much easier now!' },
  herb_lore: { name: 'Herb Lore', text: '{name} of {band} remembered which herbs heal and which poison.', kids: '{name} found out which plants cure a tummy ache.' },
  burial: { name: 'Burial Rites', text: '{Band} sent off its dead with a rite for the first time. {name} sang over the grave.', kids: '{Band} began to remember its grandmothers and grandfathers with songs.' },
  spear: { name: 'Spear', text: '{name} of {band} tied a stone point to a long stick. Hunting gets safer.', kids: '{name} invented the spear. Hunters no longer have to get so close to the beasts.' },
  clothing: { name: 'Hide Clothing', text: '{name} of {band} sewed the first clothes from hides. Winter is no longer a death sentence.', kids: '{name} sewed warm clothes from hides. Now you can go out in winter too!' },
  cave_art: { name: 'Cave Paintings', text: '{name} of {band} painted a hunt on the cave wall with ochre and charcoal.', kids: '{name} painted animals on the cave wall. The first pictures in the world!' },
  fishing: { name: 'Fishing', text: '{name} of {band} learned to catch fish with a harpoon.', kids: '{name} caught the first fish with a harpoon. The river gives food now!' },
  shelter: { name: 'Tents', text: '{name} of {band} stretched hides over bones and branches. The first tents.', kids: '{name} made a tent. Now you can sleep dry anywhere.' },
  bow: { name: 'Bow and Arrows', text: '{name} of {band} strung sinew on a bent stick. The bow strikes from afar.', kids: '{name} invented the bow! Arrows fly far.' },
  dog: { name: 'Tamed Dog', text: 'Wolf pups stayed by the fire of {band}. {name} fed them and they became the first dogs.', kids: '{name} found a friend: a little wolf cub that became the first dog!' },
  grinding: { name: 'Grain Grinding', text: '{name} of {band} ground wild grain between two stones. The flour becomes food for the winter.', kids: '{name} crushed seeds between two stones and made flour.' },
  agriculture: { name: 'Agriculture', text: '{name} of {band} noticed that fallen grains sprout new plants. The clan sows its first field and stops wandering.', kids: '{name} planted seeds and new plants grew from them! People can stay in one place now.' },
  pottery: { name: 'Pottery', text: '{name} of {band} fired clay in the fire. Pots keep food safe from mice and damp.', kids: '{name} baked a clay pot. Now food keeps for a long time!' },
  herding: { name: 'Herding', text: '{name} of {band} penned wild goats in a fold. Meat and milk without hunting.', kids: '{name} tamed goats. Now there is milk every day!' },
  weaving: { name: 'Weaving', text: '{name} of {band} spun flax into thread and wove it into cloth.', kids: '{name} wove the first cloth. Clothes become soft and light.' },
  mudbrick: { name: 'Mud Houses', text: 'In {band}, {name} raised the first house of wattle and daub. The village starts to feel like home.', kids: '{name} built a real house of clay!' },
  boats: { name: 'Dugout Canoe', text: '{name} of {band} carved a canoe from a log. Rivers are no longer a border.', kids: '{name} made a boat and set off down the river!' },
};
const TECH_BG: Record<string, string> = {
  Огън: 'fire', 'Каменни сечива': 'stone_tools', 'Познание за билките': 'herb_lore', 'Погребални обреди': 'burial', Копие: 'spear',
  'Облекло от кожи': 'clothing', 'Скални рисунки': 'cave_art', Риболов: 'fishing', Шатри: 'shelter', 'Лък и стрели': 'bow',
  'Опитомено куче': 'dog', 'Мелене на зърно': 'grinding', Земеделие: 'agriculture', Керамика: 'pottery', Скотовъдство: 'herding',
  Тъкане: 'weaving', 'Глинени къщи': 'mudbrick', 'Лодка от дънер': 'boats',
};
/** a tech by its Bulgarian name (what the server sends) */
export function techEn(bg: string): string {
  const id = TECH_BG[bg];
  return id ? TECH_EN[id].name : bg;
}

export const ERAS_EN = ['Stone Age', 'New Stone Age', 'Bronze Age', 'Iron Age', 'Middle Ages', 'Early Modern Age', 'Industrial Age', 'Information Age', 'Space Age'];
const ERA_BG = ['Каменна епоха', 'Новокаменна епоха', 'Бронзова епоха', 'Желязна епоха', 'Средновековие', 'Нова епоха', 'Индустриална епоха', 'Информационна епоха', 'Космическа епоха'];
export function eraEn(bg: string): string {
  const i = ERA_BG.indexOf(bg);
  return i < 0 ? bg : ERAS_EN[i];
}

export const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const CHIEF_TITLES_EN = ['Elder', 'Elder', 'Chieftain', 'Prince', 'Mayor', 'Mayor', 'Mayor', 'Mayor', 'Mayor'];
const CHIEF_BG: Record<string, string> = { Старейшина: 'Elder', Вожд: 'Chieftain', Княз: 'Prince', Кмет: 'Mayor' };
export function chiefEn(bg: string): string {
  return CHIEF_BG[bg] ?? CHIEF_BG[bg[0]?.toUpperCase() + bg.slice(1)] ?? bg;
}

export const TASK_NAMES_EN: Record<string, string> = {
  rest: 'resting', gather: 'gathering fruit and roots', hunt: 'hunting', fish: 'fishing', craft: 'making tools', farm: 'tending the field',
  herd: 'herding the animals', build: 'building', child: 'playing', elder: 'telling stories', travel: 'travelling', lead: 'leading the clan',
  scout: 'looking for a new camp', chop: 'chopping wood',
};
const TASK_BG: Record<string, string> = {
  почива: 'rest', 'събира плодове и корени': 'gather', ловува: 'hunt', 'лови риба': 'fish', 'прави сечива': 'craft', 'обработва нивата': 'farm',
  'пасе животните': 'herd', строи: 'build', играе: 'child', 'разказва истории': 'elder', пътува: 'travel', 'води рода': 'lead',
  'търси ново място за лагера': 'scout', 'сече дърва': 'chop',
};
export function taskEn(bg: string): string {
  const k = TASK_BG[bg];
  return k ? TASK_NAMES_EN[k] : bg;
}

export const BIOME_NAMES_EN: Record<number, string> = {
  0: 'Deep sea', 1: 'Sea', 2: 'Shore', 3: 'Meadows', 4: 'Plains', 5: 'Broadleaf forest', 6: 'Conifer forest', 7: 'Hills',
  8: 'Mountain', 9: 'Lasting snow', 10: 'Wasteland', 11: 'Tundra', 12: 'Marsh', 13: 'Lake',
};

export const GENE_EN: Record<string, string> = {
  Сила: 'Strength', Ум: 'Wit', Любопитство: 'Curiosity', Общителност: 'Sociability', Здраве: 'Health', Дълголетие: 'Longevity',
};

export const CAUSE_EN: Record<string, string> = {
  'загина на лов': 'died on a hunt',
  'почина в гладна година': 'died in a hungry year',
  'почина в лютата зима': 'died in the bitter winter',
  'почина от старост': 'died of old age',
  'почина като дете': 'died as a child',
  'почина от болест': 'died of illness',
};
export const causeEn = (bg: string) => CAUSE_EN[bg] ?? bg;

export const BEAST_EN: Record<string, string> = {
  мамут: 'a mammoth', 'пещерна мечка': 'a cave bear', 'огромен зубър': 'a huge wisent', 'стадо диви коне': 'a herd of wild horses', 'гигантски елен': 'a giant deer',
};

export const FEATURE_EN: Record<string, string> = {
  реката: 'the river', гората: 'the forest', хълмовете: 'the hills', морето: 'the sea', 'голямата поляна': 'the great meadow',
};

export function formatYearEn(year: number): string {
  const y = Math.abs(Math.round(year)).toLocaleString('en-US');
  return year < 0 ? `${y} BC` : `AD ${y}`;
}

/** years written by the server inside a Bulgarian text: "11 900 г. пр.н.е." -> "11,900 BC" */
export function yearsInTextEn(s: string): string {
  return s.replace(/(\d[\d\s  ]*) г\.( пр\.н\.е\.)?/g, (_, n: string, bc?: string) => formatYearEn((bc ? -1 : 1) * Number(n.replace(/\D/g, ''))));
}

/** a person's deeds as the server stores them in Bulgarian */
export function deedEn(d: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^Откри „(.+)“ \((.+)\)$/.exec(d))) return `Discovered “${techEn(m[1])}” (${yearsInTextEn(m[2])})`;
  if ((m = /^Преоткри „(.+)“ за своя род$/.exec(d))) return `Rediscovered “${techEn(m[1])}” for the clan`;
  if ((m = /^Доживя до 70 години \((.+)\)$/.exec(d))) return `Lived to 70 (${yearsInTextEn(m[1])})`;
  if ((m = /^Основа (.+) и стана негов (\S+) \((.+)\)$/.exec(d))) return `Founded the ${bandEn(m[1])} and became its ${chiefEn(m[2]).toLowerCase()} (${yearsInTextEn(m[3])})`;
  if ((m = /^Поведе лова на (.+)$/.exec(d))) return `Led the hunt for ${BEAST_EN[m[1]] ?? m[1]}`;
  return yearsInTextEn(d);
}

/** "Старейшина на Бялово" / "Старейшина на рода на Вълка" */
export function titleEn(s: string): string {
  const m = /^(\S+) на (.+)$/.exec(s);
  return m ? `${chiefEn(m[1])} of ${bandTextEn(m[2])}` : s;
}

export const SECRET_HEROES_EN: string[] = [
  'Clever Peter', 'Nasreddin Hodja', 'Prince Marko', 'Peter Pan', 'Cinderella',
  'Snow White', 'Little Red Riding Hood', 'Puss in Boots', 'Pinocchio', 'Alice',
  'Hansel', 'Gretel', 'Thumbelina', 'The Little Mermaid', 'The Ugly Duckling',
  'Sleeping Beauty', 'Rapunzel', 'Rumpelstiltskin', 'Aladdin', 'Ali Baba',
  'Sinbad the Sailor', 'Baron Munchausen', 'Gulliver', 'Robinson Crusoe', 'Tom Sawyer',
  'Huck Finn', 'Dorothy', 'The Tin Woodman', 'The Cowardly Lion', 'The Scarecrow',
  'Winnie-the-Pooh', 'Piglet', 'Eeyore', 'Baba Yaga', 'Koschei the Deathless',
  'Ivan Tsarevich', 'Vasilisa the Wise', 'The Firebird', 'Sivka-Burka', 'Kolobok',
  'Zmey Goryanin', 'The Samodiva', 'The Golden Girl', 'Auntie Fox', 'Uncle Wolf',
  'Bunny Bayo', 'Granny Bear', 'Grandfather Frost', 'Snegurochka', 'The Steadfast Tin Soldier',
  'The Snow Queen', 'Gerda', 'Kai', 'The Bremen Town Musicians', 'The Brave Little Tailor',
  'Tom Thumb', 'Goldilocks', 'Beauty', 'The Beast', 'Bluebeard',
  'The Princess and the Pea', 'Eliza', 'Tsar Saltan', 'The Golden Fish', 'Emelya',
  'The Sea King', 'Robin Hood', 'King Arthur', 'Merlin', 'Lancelot',
  'Nils Holgersson', 'The Frog King', 'The Unborn Maiden', "Grandpa's Mitten", 'The Wheat Loaf',
  'Ivan the Fool', 'The Frog Princess', 'The Silent Princess', 'The Tortoise', 'The Swift Hare',
  'Sly Fox', 'The Cricket', 'The Ant', 'The Raven', 'Scheherazade',
  'The Genie of the Lamp', 'Little Muck', 'Caliph Stork', 'Dwarf Nose', 'The Nutcracker',
  'King Thrushbeard', 'Jack', 'The Little Match Girl', 'The Chimney Sweep', 'Naf-Naf',
  'Nuf-Nuf', 'Nif-Nif', 'The Little Red Hen', 'Grandpa and the Turnip', 'The Chronicler',
];

export const SECRET_KINDS_EN: Record<string, { name: string; text: string }> = {
  ufo: { name: 'a flying saucer', text: 'A quiet silver saucer hangs low over the grass and glows. Nobody in the chronicle knows where it came from.' },
  meteor: { name: 'a fallen meteorite', text: 'A stone from the sky, still warm. The grass around it is scorched.' },
  eggs: { name: 'a nest of painted eggs', text: 'Someone painted the eggs with red and blue patterns and hid them in a nest. Easter came a few thousand years early.' },
  goldegg: { name: 'a golden egg', text: 'An egg of pure gold on a stone. Now and then it cracks and something shines inside.' },
  robot: { name: 'a rusty robot', text: 'A small robot overgrown with moss. When you look at it, its eyes light up and it waves at you.' },
  stag: { name: 'a ghostly stag', text: 'A white glowing stag stands among the trees and slowly falls apart into sparks.' },
  dragon: { name: 'a sleeping dragon', text: 'A tiny green dragon sleeps on a heap of gold coins. One of its eyes opens.' },
  portal: { name: 'a portal in a stone circle', text: 'Blue light turns between ancient stones. Where it leads is written nowhere.' },
};

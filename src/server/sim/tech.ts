// Discoveries. Each one is found by a real person in a real band, and can spread or be forgotten.

export type Need = 'flint' | 'clay' | 'grain' | 'wildHerd' | 'fish' | 'forest' | 'ore' | null;

export interface Tech {
  id: string;
  name: string;
  era: number;
  prereq: string[];
  need: Need;
  /** chance per adult-month for a person with average wit and curiosity, before pacing */
  base: number;
  /** year the first discovery is expected around (the real history, squeezed to the game's calendar) */
  target: number;
  /** which gene helps most */
  gene: 'int' | 'cur' | 'soc' | 'str';
  text: string; // {name} {band}
  kids: string;
}

export const ERAS = [
  { name: 'Каменна епоха', startYear: -12000, targetDay: 0, yearsPerMin: 0.33 },
  { name: 'Новокаменна епоха', startYear: -7000, targetDay: 10, yearsPerMin: 0.21 },
  { name: 'Бронзова епоха', startYear: -3300, targetDay: 22, yearsPerMin: 0.15 },
  { name: 'Желязна епоха', startYear: -1200, targetDay: 32, yearsPerMin: 0.09 },
  { name: 'Средновековие', startYear: 500, targetDay: 45, yearsPerMin: 0.035 },
  { name: 'Нова епоха', startYear: 1500, targetDay: 62, yearsPerMin: 0.02 },
  { name: 'Индустриална епоха', startYear: 1760, targetDay: 72, yearsPerMin: 0.009 },
  { name: 'Информационна епоха', startYear: 1950, targetDay: 85, yearsPerMin: 0.0105 },
  { name: 'Космическа епоха', startYear: 2030, targetDay: 92, yearsPerMin: 0.0105 },
];

export const TECHS: Tech[] = [
  { id: 'fire', name: 'Огън', era: 0, target: -11930, prereq: [], need: null, base: 0.0035, gene: 'cur',
    text: '{name} от {band} опитоми огъня. Нощите вече не са толкова студени и страшни.',
    kids: '{name} запали първия огън! Сега хората се топлят и пекат храната си.' },
  { id: 'stone_tools', name: 'Каменни сечива', era: 0, target: -11850, prereq: [], need: 'flint', base: 0.004, gene: 'int',
    text: '{name} от {band} се научи да цепи кремък на остри остриета.',
    kids: '{name} направи нож от камък. С него се реже много по-лесно!' },
  { id: 'herb_lore', name: 'Познание за билките', era: 0, target: -11450, prereq: [], need: 'forest', base: 0.002, gene: 'int',
    text: '{name} от {band} запомни кои билки лекуват и кои тровят.',
    kids: '{name} разбра кои растения лекуват болки в корема.' },
  { id: 'burial', name: 'Погребални обреди', era: 0, target: -11700, prereq: [], need: null, base: 0.0015, gene: 'soc',
    text: '{Band} за първи път изпрати починалите си с обред. {name} пя над гроба.',
    kids: '{Band} започна да помни своите баби и дядовци с песни.' },
  { id: 'spear', name: 'Копие', era: 0, target: -11600, prereq: ['stone_tools'], need: null, base: 0.004, gene: 'str',
    text: '{name} от {band} върза каменен връх на дълга пръчка. Ловът става по-безопасен.',
    kids: '{name} измисли копието. Ловците вече не трябва да се приближават толкова до зверовете.' },
  { id: 'clothing', name: 'Облекло от кожи', era: 0, target: -11300, prereq: ['stone_tools'], need: null, base: 0.003, gene: 'int',
    text: '{name} от {band} уши първите дрехи от кожи. Зимата вече не е смъртна присъда.',
    kids: '{name} уши топли дрехи от кожа. Вече може да се излиза и през зимата!' },
  { id: 'cave_art', name: 'Скални рисунки', era: 0, target: -11000, prereq: ['fire'], need: null, base: 0.0015, gene: 'cur',
    text: '{name} от {band} нарисува лов на стената на пещерата с охра и въглен.',
    kids: '{name} нарисува животни по стената на пещерата. Първите картини на света!' },
  { id: 'fishing', name: 'Риболов', era: 0, target: -10500, prereq: ['spear'], need: 'fish', base: 0.004, gene: 'cur',
    text: '{name} от {band} се научи да лови риба с харпун.',
    kids: '{name} хвана първата риба с остен. Реката вече дава храна!' },
  { id: 'shelter', name: 'Шатри', era: 0, target: -10700, prereq: ['clothing'], need: null, base: 0.003, gene: 'int',
    text: '{name} от {band} опъна кожи върху кости и клони. Първите шатри.',
    kids: '{name} направи шатра. Вече може да се спи на сухо навсякъде.' },
  { id: 'bow', name: 'Лък и стрели', era: 0, target: -9900, prereq: ['spear'], need: 'forest', base: 0.0015, gene: 'int',
    text: '{name} от {band} опъна жила на огънато дърво. Лъкът удря отдалече.',
    kids: '{name} измисли лъка! Стрелите летят далеч.' },
  { id: 'dog', name: 'Опитомено куче', era: 0, target: -10200, prereq: ['fire', 'spear'], need: null, base: 0.0015, gene: 'soc',
    text: 'Вълчи кутрета останаха при огъня на {band}. {name} ги храни и те станаха първите кучета.',
    kids: '{name} си намери приятел: малко вълче, което стана първото куче!' },
  // gateway to the New Stone Age
  { id: 'grinding', name: 'Мелене на зърно', era: 1, target: -8800, prereq: ['stone_tools'], need: 'grain', base: 0.0025, gene: 'int',
    text: '{name} от {band} смля диви зърна между два камъка. От брашното става храна за зимата.',
    kids: '{name} смачка зрънца между два камъка и направи брашно.' },
  { id: 'agriculture', name: 'Земеделие', era: 1, target: -7100, prereq: ['grinding', 'pottery'], need: 'grain', base: 0.0008, gene: 'int',
    text: '{name} от {band} забеляза, че от падналите зърна растат нови. Родът засява първата нива и спира да скита.',
    kids: '{name} посади семена и от тях израснаха нови растения! Хората вече могат да остават на едно място.' },
  { id: 'pottery', name: 'Керамика', era: 1, target: -8300, prereq: ['fire'], need: 'clay', base: 0.002, gene: 'cur',
    text: '{name} от {band} изпече глина в огъня. Гърнетата пазят храната от мишки и влага.',
    kids: '{name} изпече глинено гърне. Сега храната може да се пази дълго!' },
  { id: 'herding', name: 'Скотовъдство', era: 1, target: -7900, prereq: ['dog'], need: 'wildHerd', base: 0.0015, gene: 'soc',
    text: '{name} от {band} затвори диви кози в кошара. Месо и мляко без лов.',
    kids: '{name} опитоми кози. Вече има мляко всеки ден!' },
  { id: 'weaving', name: 'Тъкане', era: 1, target: -6600, prereq: ['agriculture'], need: null, base: 0.0025, gene: 'int',
    text: '{name} от {band} изпреде нишки от лен и ги изтъка на плат.',
    kids: '{name} изтъка първия плат. Дрехите стават меки и леки.' },
  { id: 'mudbrick', name: 'Глинени къщи', era: 1, target: -6300, prereq: ['agriculture', 'pottery'], need: null, base: 0.003, gene: 'str',
    text: 'В {band} {name} издигна първата къща от плет и глина. Селото започва да прилича на дом.',
    kids: '{name} построи истинска къща от глина!' },
  { id: 'boats', name: 'Лодка от дънер', era: 1, target: -9400, prereq: ['stone_tools', 'fishing'], need: 'fish', base: 0.0015, gene: 'cur',
    text: '{name} от {band} издълба лодка от дънер. Реките вече не са граница.',
    kids: '{name} направи лодка и тръгна по реката!' },
  // copper age: the last steps of the farmers before bronze
  { id: 'copper', name: 'Мед', era: 1, target: -4500, prereq: ['fire', 'pottery'], need: 'ore', base: 0.002, gene: 'cur',
    text: '{name} от {band} забеляза, че зелен камък в жарта на грънчарската пещ пуска червен блестящ метал. Първите медни игли и шила.',
    kids: '{name} разтопи зелен камък в огъня и от него потече червен метал: мед!' },
  { id: 'plough', name: 'Рало', era: 1, target: -4000, prereq: ['agriculture', 'herding'], need: null, base: 0.0025, gene: 'int',
    text: '{name} от {band} впрегна вол в остър дървен кол. Една нива се изорава за ден, а не за седмица.',
    kids: '{name} накара вола да тегли ралото. Сега нивите стават много по-големи!' },
  { id: 'wheel', name: 'Колело', era: 1, target: -3500, prereq: ['agriculture', 'pottery'], need: null, base: 0.0015, gene: 'int',
    text: '{name} от {band} сложи дървен диск на ос. Първата каруца носи товар, какъвто трима души не биха вдигнали.',
    kids: '{name} измисли колелото! Каруцата вози тежки неща вместо хората.' },
  // gateway to the Bronze Age
  { id: 'bronze', name: 'Бронз', era: 2, target: -3300, prereq: ['copper'], need: 'ore', base: 0.002, gene: 'int',
    text: '{name} от {band} смеси мед с калай и получи метал, по-твърд от всеки камък. Започва нова епоха.',
    kids: '{name} смеси два метала и стана бронз: твърд и златист!' },
  { id: 'sailing', name: 'Платно', era: 2, target: -3100, prereq: ['boats', 'weaving'], need: 'fish', base: 0.0015, gene: 'cur',
    text: '{name} от {band} опъна тъкано платно на лодката. Вятърът я носи по-далеч, отколкото гребците стигат.',
    kids: '{name} сложи платно на лодката и вятърът я забута!' },
  { id: 'writing', name: 'Писменост', era: 2, target: -3000, prereq: ['pottery', 'mudbrick'], need: null, base: 0.001, gene: 'int',
    text: '{name} от {band} издълба знаци в мокра глина, за да запомни колко жито има в хамбара. Първото писмо.',
    kids: '{name} нарисува знаци в глината, които другите могат да прочетат. Това е писането!' },
  { id: 'trade', name: 'Търговия', era: 2, target: -2800, prereq: ['wheel'], need: null, base: 0.002, gene: 'soc',
    text: '{name} от {band} натовари каруца с гърнета и се върна с кремък, сол и мед. Съседите вече си помагат.',
    kids: '{name} размени гърнета за сол със съседите. И двамата останаха доволни!' },
  { id: 'walls', name: 'Крепостни стени', era: 2, target: -2600, prereq: ['mudbrick', 'bronze'], need: null, base: 0.002, gene: 'str',
    text: '{Band} издигна каменни стени около къщите. {name} поведе строежа. Селото става град.',
    kids: '{name} построи висока стена около селото. Сега то е истински град!' },
  { id: 'calendar', name: 'Календар', era: 2, target: -2400, prereq: ['writing', 'agriculture'], need: null, base: 0.0015, gene: 'int',
    text: '{name} от {band} преброи дните от едно пълнолуние до друго и записа кога да се сее. Реколтата вече не закъснява.',
    kids: '{name} разбра кога точно да се сеят семената, като гледа луната и звездите.' },
  { id: 'horse', name: 'Опитомен кон', era: 2, target: -2000, prereq: ['herding', 'wheel'], need: 'wildHerd', base: 0.0015, gene: 'soc',
    text: '{name} от {band} опитоми див кон и го впрегна в каруцата. Пътят до съседите стана три пъти по-кратък.',
    kids: '{name} се сприятели с кон и сега яздят заедно!' },
];

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

/** Era of a set of known techs: the highest era with a defining tech known. */
export function eraOf(techs: Set<string>): number {
  if (techs.has('bronze')) return 2;
  if (techs.has('agriculture')) return 1;
  return 0;
}

export function techCountForEra(era: number): number {
  return TECHS.filter((t) => t.era === era).length;
}

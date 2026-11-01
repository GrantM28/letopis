# Източници и лицензи

Всичко, което Летопис взима отвън, е записано тук: какво е, откъде е, кой е авторът и под какъв лиценз е.
Правило: ползваме само CC0, CC-BY и MIT/BSD/ISC/Apache-подобни лицензи. Без CC-NC и без ресурси с неясен лиценз.
При всяко ново заемане се добавя ред в таблицата **в същия commit**.

## Графика, текстури, шейдъри, звуци, шрифтове

Към момента (етап 1) **няма заети графични ресурси**. Всичко се рисува от кода:

| Какво | Как е направено | Автор | Лиценз |
|---|---|---|---|
| Терен, дървета, планини, реки, сняг | Рисува се с векторни фигури в `src/client/render.ts` | проектът | собствен код |
| Хора, шатри, колиби, къщи, огън, ниви | Генерирани текстури в `WorldRenderer.makeTextures()` | проектът | собствен код |
| Шейдър за водата | Собствен GLSL в `src/client/render.ts` (`WATER_FRAG`) | проектът | собствен код |
| Simplex шум | Собствена реализация на публично описания алгоритъм на Ken Perlin (`src/shared/noise.ts`) | проектът | собствен код |
| Генератор на случайни числа sfc32 | Собствена реализация на публичния алгоритъм на Chris Doty-Humphrey (PractRand), `src/shared/rng.ts` | проектът | собствен код |
| Икона | `public/favicon.svg`, нарисувана на ръка | проектът | собствен код |
| Шрифтове | Системни шрифтове на устройството, нищо не се сваля | – | – |

## Имена

Българските лични имена, прякорите, корените на селищата и тотемите на родовете са общоупотребими думи и имена,
събрани ръчно в `src/server/sim/names.ts`. Не са копирани от защитена база данни.

## Софтуерни библиотеки

Влизат в готовия образ или в браузъра:

| Пакет | Версия | Лиценз | Източник | Къде се ползва |
|---|---|---|---|---|
| pixi.js | 8.13.2 | MIT | https://github.com/pixijs/pixijs | рисуване в браузъра (WebGL) |
| @pixi/colord | 2.9.6 | MIT | https://github.com/pixijs/colord | зависимост на pixi.js |
| @xmldom/xmldom | 0.8.15 | MIT | https://github.com/xmldom/xmldom | зависимост на pixi.js |
| earcut | 3.2.4 | ISC | https://github.com/mapbox/earcut | зависимост на pixi.js |
| eventemitter3 | 5.0.4 | MIT | https://github.com/primus/eventemitter3 | зависимост на pixi.js |
| gifuct-js | 2.1.2 | MIT | https://github.com/matt-way/gifuct-js | зависимост на pixi.js |
| ismobilejs | 1.1.1 | MIT | https://github.com/kaimallea/isMobile | зависимост на pixi.js |
| parse-svg-path | 0.1.2 | MIT | https://github.com/jkroso/parse-svg-path | зависимост на pixi.js |
| tiny-lru | 11.4.7 | BSD-3-Clause | https://github.com/avoidwork/tiny-lru | зависимост на pixi.js |
| ws | 8.18.3 | MIT | https://github.com/websockets/ws | WebSocket сървър |
| Node.js | 22.20.0 | MIT (+ лицензите на вградените части) | https://nodejs.org | среда на сървъра, вграденият `node:sqlite` |

Само за компилиране (не влизат в образа):

| Пакет | Версия | Лиценз | Източник |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| esbuild | 0.25.10 | MIT | https://github.com/evanw/esbuild |
| @types/node, @types/ws | 22.18.8, 8.18.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## Вдъхновение

Идеите за бъдещето (кораби за поколения, тераформиране, колонии) идват от общите теми в класическата научна фантастика.
Не се копират сюжети, герои, имена или текстове от конкретни книги.

import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// every build gets its own id: the page reloads itself when the server runs a newer build
const BUILD = process.env.LETOPIS_BUILD || Date.now().toString(36);
// shown version: package.json "1.7.0" -> "1.07". Small change: minor +1, big change: major +1 and minor 0.
const [major, minor] = JSON.parse(readFileSync('package.json', 'utf8')).version.split('.');
const VERSION = `${major}.${minor.padStart(2, '0')}`;

mkdirSync('dist/public', { recursive: true });
cpSync('public', 'dist/public', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.js',
  external: ['ws'],
  sourcemap: true,
});

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  outfile: 'dist/public/app.js',
  minify: true,
  define: { __BUILD__: JSON.stringify(BUILD), __VERSION__: JSON.stringify(VERSION) },
  sourcemap: true,
});
// cache busting for the browser
const html = readFileSync('dist/public/index.html', 'utf8')
  .replace('href="style.css"', `href="style.css?v=${BUILD}"`)
  .replace('src="app.js"', `src="app.js?v=${BUILD}"`);
writeFileSync('dist/public/index.html', html);
writeFileSync('dist/public/version.json', JSON.stringify({ build: BUILD, version: VERSION }));
console.log('build ok', VERSION, BUILD);

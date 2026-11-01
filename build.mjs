import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// every build gets its own id: the page reloads itself when the server runs a newer build
const BUILD = process.env.LETOPIS_BUILD || Date.now().toString(36);

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
  define: { __BUILD__: JSON.stringify(BUILD) },
  sourcemap: true,
});
// cache busting for the browser
const html = readFileSync('dist/public/index.html', 'utf8')
  .replace('href="style.css"', `href="style.css?v=${BUILD}"`)
  .replace('src="app.js"', `src="app.js?v=${BUILD}"`);
writeFileSync('dist/public/index.html', html);
writeFileSync('dist/public/version.json', JSON.stringify({ build: BUILD }));
console.log('build ok', BUILD);

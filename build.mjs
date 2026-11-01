import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

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
  sourcemap: true,
});
console.log('build ok');

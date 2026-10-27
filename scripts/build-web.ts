/**
 * Bundles the browser client with esbuild:
 *   src/web/theme.ts → dist/web/theme.js (IIFE, render-blocking, tiny)
 *   src/web/app.ts   → dist/web/app.js   (ES module)
 *   src/web/styles/app.css → dist/web/app.css (+ hashed font files)
 * Pass --watch for incremental rebuilds during development.
 */
import { rm } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const outdir = 'dist/web';

const common: esbuild.BuildOptions = {
  bundle: true,
  outdir,
  target: ['es2022', 'chrome110', 'firefox115', 'safari16'],
  minify: !watch,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

const builds: esbuild.BuildOptions[] = [
  { ...common, entryPoints: { theme: 'src/web/theme.ts' }, format: 'iife' },
  { ...common, entryPoints: { app: 'src/web/app.ts' }, format: 'esm' },
  {
    ...common,
    entryPoints: { app: 'src/web/styles/app.css' },
    loader: { '.woff2': 'file', '.woff': 'file' },
    assetNames: 'fonts/[name]-[hash]',
  },
];

if (!watch) await rm(outdir, { recursive: true, force: true });

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}

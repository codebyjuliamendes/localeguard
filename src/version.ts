import fs from 'node:fs';

/** Package version, resolved relative to this module so it works from both `src/` and `dist/`. */
export const VERSION: string = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

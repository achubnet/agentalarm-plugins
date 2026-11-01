import fs from 'node:fs';

/** The one version number: package.json's. */
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

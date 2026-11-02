import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const backup = new URL('../package.json.pack-backup', import.meta.url);
writeFileSync(new URL('../package.json', import.meta.url), readFileSync(backup));
rmSync(backup);

import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(path, 'utf8'));
writeFileSync(new URL('../package.json.pack-backup', import.meta.url), `${JSON.stringify(pkg, null, 2)}\n`);
const { access: _access, ...overlay } = pkg.publishConfig ?? {};
const published = { ...pkg, ...overlay };
delete published.publishConfig;
delete published.devDependencies;
writeFileSync(path, `${JSON.stringify(published, null, 2)}\n`);

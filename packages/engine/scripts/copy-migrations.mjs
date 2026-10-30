import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const source = join(root, '..', 'db', 'prisma', 'migrations');
const destination = join(root, 'migrations');
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });

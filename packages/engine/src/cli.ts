import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from './migrate';

const usage = 'Usage: anumat migrate --db <url>';

async function main(): Promise<void> {
  const databaseUrl = parseArgs(process.argv.slice(2));
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const result = await applyMigrations(databaseUrl, migrationsDir);
  if (result.applied.length === 0) {
    console.log('No pending migrations to apply.');
    return;
  }
  for (const name of result.applied) console.log(`Applied ${name}`);
}

function parseArgs(args: string[]): string {
  if (args[0] !== 'migrate') fail(usage);
  let databaseUrl: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--db') {
      index += 1;
      databaseUrl = args[index];
      continue;
    }
    if (arg?.startsWith('--db=')) {
      databaseUrl = arg.slice('--db='.length);
      continue;
    }
    fail(usage);
  }
  if (!databaseUrl) fail(usage);
  return databaseUrl;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

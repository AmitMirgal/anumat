import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

for (const path of ['.env', '../../.env']) {
  if (!existsSync(path)) continue;
  process.loadEnvFile(path);
  break;
}

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://anumat:anumat@127.0.0.1:5432/anumat';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});

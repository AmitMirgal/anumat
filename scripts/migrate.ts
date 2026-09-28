import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadConfig } from '../src/config';
import { connect } from '../src/db/client';
import { log } from '../src/log';

const { sql, db } = connect(loadConfig().databaseUrl);
try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  log.info('migrations applied');
} finally {
  await sql.end();
}

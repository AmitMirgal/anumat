import type { Config } from './config';
import { connect, type Db, type Sql } from './db/client';

export type AppContext = {
  config: Config;
  db: Db;
  sql: Sql;
};

export async function createContext(config: Config): Promise<AppContext> {
  const { db, sql } = connect(config.databaseUrl);
  return { config, db, sql };
}

export async function closeContext(ctx: AppContext): Promise<void> {
  await ctx.sql.end();
}

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function connect(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }) };
}

export type Db = ReturnType<typeof connect>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Sql = ReturnType<typeof connect>['sql'];

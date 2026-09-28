import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { AppError } from '../errors';
import * as schema from './schema';

export function connect(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }) };
}

export type Db = ReturnType<typeof connect>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Sql = ReturnType<typeof connect>['sql'];

export function one<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw new AppError('internal', 'Expected the statement to return a row');
  return row;
}

export function uniqueViolation(error: unknown): string | undefined {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (!(cause instanceof Error) || !('code' in cause) || cause.code !== '23505') return undefined;
  return 'constraint_name' in cause && typeof cause.constraint_name === 'string' ? cause.constraint_name : 'unique';
}

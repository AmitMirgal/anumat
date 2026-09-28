import { z } from 'zod';
import { AppError } from './errors';

export type PageRequest = { limit: number; cursor: string | undefined };
export type Page<T> = { items: T[]; nextCursor: string | null };

export const encodeCursor = (values: (string | number)[]) => Buffer.from(JSON.stringify(values)).toString('base64url');

export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new AppError('validation_failed', 'Invalid pagination cursor');
  }
}

export function toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => (string | number)[]): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}

export const stringCursor = z.tuple([z.string()]);
export const numberCursor = z.tuple([z.number().int()]);
export const timeCursor = z.tuple([z.iso.datetime(), z.uuid()]);

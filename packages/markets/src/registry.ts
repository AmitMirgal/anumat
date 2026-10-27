import type { Change, MarketId } from '@anumat/core';
import type { z } from 'zod';
import { diffUsExtractions } from './us/diff';
import { US_SCHEMA_ID, usExtractSchema } from './us/extract-schema';

export type { MarketId as Market };

export type { Change };

type MarketModule<T> = {
  schemaId: string;
  extractSchema: z.ZodType<T>;
  diff(previous: T | null, next: T): Change[];
};

const builtins = {
  us: { schemaId: US_SCHEMA_ID, extractSchema: usExtractSchema, diff: diffUsExtractions },
} as const satisfies { [M in MarketId]: MarketModule<unknown> };

const registered = new Map<string, MarketModule<unknown>>();

export function registerMarket(id: string, module: MarketModule<unknown>): void {
  if (id in builtins || registered.has(id)) throw new Error(`Market ${id} is already registered`);
  registered.set(id, module);
}

export function marketFor(id: string): MarketModule<unknown> {
  if (id in builtins) return builtins[id as MarketId];
  const extra = registered.get(id);
  if (!extra) throw new Error(`No market module registered for ${id}`);
  return extra;
}

export const markets = builtins;

export const extractSchemas = { us: markets.us.extractSchema } as const satisfies { [M in MarketId]: z.ZodType };

export type Extraction = z.infer<(typeof extractSchemas)[MarketId]>;

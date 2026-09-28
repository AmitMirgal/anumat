import type { z } from 'zod';
import type { market } from '../db/schema';
import { diffUsExtractions } from './us/diff';
import { US_SCHEMA_ID, usExtractSchema } from './us/extract-schema';

export type Market = (typeof market.enumValues)[number];

export type Change = {
  field: string;
  kind: 'added' | 'removed' | 'changed';
  key?: string;
  before?: unknown;
  after?: unknown;
};

type MarketModule<T> = {
  schemaId: string;
  extractSchema: z.ZodType<T>;
  diff(previous: T | null, next: T): Change[];
};

export const markets = {
  us: { schemaId: US_SCHEMA_ID, extractSchema: usExtractSchema, diff: diffUsExtractions },
} as const satisfies { [M in Market]: MarketModule<unknown> };

export const extractSchemas = { us: markets.us.extractSchema } as const satisfies { [M in Market]: z.ZodType };

export type Extraction = z.infer<(typeof extractSchemas)[Market]>;

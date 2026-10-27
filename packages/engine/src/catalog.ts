import { type Db, uniqueViolation } from '@anumat/db';
import type { Payer, PolicySource } from '@anumat/db';
import { AppError } from '@anumat/core';
import type { Market } from '@anumat/markets';
import { type Page, type PageRequest, decodeCursor, stringCursor, toPage } from '@anumat/core';

export type { Payer, PolicySource };

export const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function conflict(error: unknown, message: string, details: Record<string, unknown>): never {
  const constraint = uniqueViolation(error);
  if (constraint) throw new AppError('conflict', message, { ...details, constraint });
  throw error;
}

export async function registerPayer(db: Db, input: { name: string; slug: string; market: Market }): Promise<Payer> {
  try {
    return await db.payer.create({ data: input });
  } catch (error) {
    return conflict(error, `A payer with slug ${input.slug} already exists`, { slug: input.slug });
  }
}

export async function getPayer(db: Db, id: string): Promise<Payer> {
  const payer = await db.payer.findUnique({ where: { id } });
  if (!payer) throw new AppError('not_found', `Payer ${id} not found`);
  return payer;
}

export async function findPayerBySlug(db: Db, slug: string): Promise<Payer | null> {
  return db.payer.findUnique({ where: { slug } });
}

export async function listPayers(db: Db, page: PageRequest): Promise<Page<Payer>> {
  const after = page.cursor ? decodeCursor(page.cursor, stringCursor)[0] : undefined;
  const rows = await db.payer.findMany({
    where: after === undefined ? undefined : { slug: { gt: after } },
    orderBy: { slug: 'asc' },
    take: page.limit + 1,
  });
  return toPage(rows, page.limit, (row) => [row.slug]);
}

export async function registerSource(
  db: Db,
  input: {
    payerId: string;
    title: string;
    sourceUrl: string;
    policySlug?: string | undefined;
    market?: Market | undefined;
    checkIntervalHours?: number | undefined;
    enabled?: boolean | undefined;
  },
): Promise<PolicySource> {
  const payer = await getPayer(db, input.payerId);
  if (input.market && input.market !== payer.market) {
    throw new AppError('validation_failed', `Source market ${input.market} does not match payer market ${payer.market}`);
  }
  const policyKey = `${payer.slug}.${input.policySlug ?? slugify(input.title)}`;
  try {
    return await db.policySource.create({
      data: {
        payerId: payer.id,
        market: payer.market,
        policyKey,
        title: input.title,
        sourceUrl: input.sourceUrl,
        checkIntervalHours: input.checkIntervalHours,
        enabled: input.enabled,
      },
    });
  } catch (error) {
    return conflict(error, `A source with policy key ${policyKey} or URL ${input.sourceUrl} already exists`, {
      policy_key: policyKey,
      source_url: input.sourceUrl,
    });
  }
}

export async function getSource(db: Db, id: string): Promise<PolicySource> {
  const source = await db.policySource.findUnique({ where: { id } });
  if (!source) throw new AppError('not_found', `Source ${id} not found`);
  return source;
}

export async function findSourceByPolicyKey(db: Db, policyKey: string): Promise<PolicySource | null> {
  return db.policySource.findUnique({ where: { policyKey } });
}

export async function listSources(db: Db, page: PageRequest): Promise<Page<PolicySource>> {
  const after = page.cursor ? decodeCursor(page.cursor, stringCursor)[0] : undefined;
  const rows = await db.policySource.findMany({
    where: after === undefined ? undefined : { policyKey: { gt: after } },
    orderBy: { policyKey: 'asc' },
    take: page.limit + 1,
  });
  return toPage(rows, page.limit, (row) => [row.policyKey]);
}

import { asc, eq, gt } from 'drizzle-orm';
import { type Db, one, uniqueViolation } from './db/client';
import { payers, policySources } from './db/schema';
import { AppError } from './errors';
import type { Market } from './markets/registry';
import { type Page, type PageRequest, decodeCursor, stringCursor, toPage } from './pagination';

export type Payer = typeof payers.$inferSelect;
export type PolicySource = typeof policySources.$inferSelect;

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
    return one(await db.insert(payers).values(input).returning());
  } catch (error) {
    return conflict(error, `A payer with slug ${input.slug} already exists`, { slug: input.slug });
  }
}

export async function getPayer(db: Db, id: string): Promise<Payer> {
  const [payer] = await db.select().from(payers).where(eq(payers.id, id));
  if (!payer) throw new AppError('not_found', `Payer ${id} not found`);
  return payer;
}

export async function findPayerBySlug(db: Db, slug: string): Promise<Payer | undefined> {
  const [payer] = await db.select().from(payers).where(eq(payers.slug, slug));
  return payer;
}

export async function listPayers(db: Db, page: PageRequest): Promise<Page<Payer>> {
  const after = page.cursor ? decodeCursor(page.cursor, stringCursor)[0] : undefined;
  const rows = await db
    .select()
    .from(payers)
    .where(after === undefined ? undefined : gt(payers.slug, after))
    .orderBy(asc(payers.slug))
    .limit(page.limit + 1);
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
    return one(
      await db
        .insert(policySources)
        .values({
          payerId: payer.id,
          market: payer.market,
          policyKey,
          title: input.title,
          sourceUrl: input.sourceUrl,
          checkIntervalHours: input.checkIntervalHours,
          enabled: input.enabled,
        })
        .returning(),
    );
  } catch (error) {
    return conflict(error, `A source with policy key ${policyKey} or URL ${input.sourceUrl} already exists`, {
      policy_key: policyKey,
      source_url: input.sourceUrl,
    });
  }
}

export async function getSource(db: Db, id: string): Promise<PolicySource> {
  const [source] = await db.select().from(policySources).where(eq(policySources.id, id));
  if (!source) throw new AppError('not_found', `Source ${id} not found`);
  return source;
}

export async function findSourceByPolicyKey(db: Db, policyKey: string): Promise<PolicySource | undefined> {
  const [source] = await db.select().from(policySources).where(eq(policySources.policyKey, policyKey));
  return source;
}

export async function listSources(db: Db, page: PageRequest): Promise<Page<PolicySource>> {
  const after = page.cursor ? decodeCursor(page.cursor, stringCursor)[0] : undefined;
  const rows = await db
    .select()
    .from(policySources)
    .where(after === undefined ? undefined : gt(policySources.policyKey, after))
    .orderBy(asc(policySources.policyKey))
    .limit(page.limit + 1);
  return toPage(rows, page.limit, (row) => [row.policyKey]);
}

import { findPayerBySlug, findSourceByPolicyKey, registerPayer, registerSource } from '../src/catalog';
import { loadConfig } from '../src/config';
import { connect } from '../src/db/client';
import { log } from '../src/log';
import { US_SEED_PAYERS, US_SEED_SOURCES } from '../src/markets/us/seed-sources';

const db = connect(loadConfig().databaseUrl);
try {
  const payerIds = new Map<string, string>();
  for (const payer of US_SEED_PAYERS) {
    const row = (await findPayerBySlug(db, payer.slug)) ?? (await registerPayer(db, { ...payer, market: 'us' }));
    payerIds.set(payer.slug, row.id);
  }
  for (const seed of US_SEED_SOURCES) {
    const payerId = payerIds.get(seed.payerSlug);
    if (!payerId) throw new Error(`Seed source ${seed.policySlug} names unknown payer ${seed.payerSlug}`);
    const policyKey = `${seed.payerSlug}.${seed.policySlug}`;
    const existing = await findSourceByPolicyKey(db, policyKey);
    const source =
      existing ??
      (await registerSource(db, { payerId, title: seed.title, sourceUrl: seed.sourceUrl, policySlug: seed.policySlug }));
    log.info({ policyKey: source.policyKey, sourceId: source.id, created: !existing, url: source.sourceUrl }, 'seed source');
  }
} finally {
  await db.$disconnect();
}

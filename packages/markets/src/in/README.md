# India market (not implemented)

Anumat ships the US market only. Nothing in this folder runs, and no India payer, source, extract schema, form, or claim flow exists.

The seams an India market would plug into are these:

1. Add `in` to the `Market` enum in `prisma/schema.prisma` and create a migration with `pnpm exec prisma migrate dev --name <name>`.
2. Add an `in` entry to `markets` in `src/markets/registry.ts` with its own `schemaId`, Zod `extractSchema`, and pure `diff`. The compiler then flags every place that must handle the new market.
3. Register India payers and sources with `market: 'in'`. The watch, convert, extract, diff, approve, and publish stages stay the same.
4. Add India eval fixtures under `evals/fixtures/` before any extraction behavior ships.

India product scope (IRDAI forms, cashless pre-authorization, claim submission) belongs to a separate product decision and is out of scope here.

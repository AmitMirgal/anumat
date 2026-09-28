# Anumat

Anumat is an HTTP API for US prior-authorization rules. It watches public payer medical policy PDFs and converts each new version to markdown. A Mastra agent extracts the prior-auth rules into a versioned schema. Anumat diffs every extraction against the last approved version and serves a version only after a person approves it.

This repository is US Layer A. It ships the US market only. India plugs in later through the market seams described under [Architecture](#architecture). Anumat is a separate product from Pramaan, its India sibling.

## Run it locally

You need Node 24 (see `.nvmrc`), pnpm 10, and PostgreSQL 16.

1. Start Postgres with a role `anumat` (password `anumat`) and two databases, `anumat` and `anumat_test`. With Docker:

   ```bash
   docker run -d --name anumat-postgres -p 5432:5432 \
     -e POSTGRES_USER=anumat -e POSTGRES_PASSWORD=anumat -e POSTGRES_DB=anumat postgres:16
   docker exec anumat-postgres createdb -U anumat anumat_test
   ```

2. Create `.env` from the example, and replace the `ANUMAT_API_KEYS` value with `dev:` followed by a random string of 16 or more characters.

   ```bash
   cp .env.example .env
   ```

3. Install dependencies, apply the migrations, and start the server.

   ```bash
   pnpm install
   pnpm db:migrate
   pnpm dev
   ```

   The API listens on `http://127.0.0.1:4471`. `curl http://127.0.0.1:4471/health` returns `{"status":"ok"}`.

4. To register the three verified US policy sources, run `pnpm db:seed`.

5. To run the whole loop once over HTTP, run `pnpm demo`. It needs network access to `uhcprovider.com`.

Without `ANTHROPIC_API_KEY` (or the key for the provider you configure), a check still fetches, stores, and converts the PDF. The run then stops with the error `llm_not_configured`, which names the missing variable.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the API on port 4471 and restarts it when a file changes. |
| `pnpm start` | Starts the API without file watching. |
| `pnpm db:migrate` | Applies the migrations in `drizzle/` to `DATABASE_URL`. |
| `pnpm db:generate` | Generates a migration after a change to `src/db/schema.ts`. |
| `pnpm db:seed` | Registers UnitedHealthcare, Cigna, and three policy PDFs. It skips rows that already exist. |
| `pnpm watch` | Checks every enabled source whose `check_interval_hours` has passed, then exits. Run it from cron, for example `*/30 * * * * cd /path/to/anumat && pnpm watch`. |
| `pnpm test` | Runs the unit and integration tests against `TEST_DATABASE_URL`. |
| `pnpm eval` | Runs the Mastra evals offline. It exits 1 on a schema-validity regression. |
| `pnpm demo` | Registers a payer and the live UHC Bariatric Surgery PDF, then checks, diffs, approves, and reads it over HTTP. |
| `pnpm typecheck` | Type-checks the project with `tsc --noEmit`. |
| `pnpm exec tsx scripts/context-report.ts` | Reports how many characters of each converted document the agent reads. |

## Architecture

```mermaid
flowchart TD
  client["API client or reviewer"] -->|Bearer API key| api["Hono API /v1"]
  cron["pnpm watch from cron"] --> check
  api -->|"POST /v1/sources/:id/check"| check["checkSource"]
  check --> adapter["http_pdf source adapter"]
  adapter -->|"PDF bytes, SHA-256"| blobs[("BlobStore, ./data/policies or S3 stub")]
  check --> convert["anydoc, or Firecrawl Parse when pages need OCR"]
  convert --> triage
  subgraph agent["Mastra AgentController, one session per job"]
    triage["triage mode, cheap model"] --> extract["extract mode, strong model"]
    diffmode["diff mode, cheap model"]
    reviewmode["review mode, strong model"]
  end
  extract -->|save_extraction| propose["proposeVersion parses, supersedes, and diffs"]
  propose --> db[("Postgres")]
  propose --> diffmode
  propose --> reviewmode
  api -->|"POST /v1/versions/:id/approve"| approve["approveVersion"]
  approve --> db
  api -->|"GET /v1/policies/:policyKey"| db
  subgraph markets["Market registry, the plugin seam"]
    us["us market with extractSchemas.us, the US diff, and US seeds"]
    india["in market, README only, not implemented"]
  end
  propose -.->|"markets[source.market]"| markets
  extract -.->|"save_extraction input schema"| markets
```

### The market plugin seam

`market` is a column on payers, policy sources, and policy versions, and a literal in each extraction. Composite foreign keys keep those copies equal. `src/markets/registry.ts` maps each market to its `schemaId`, its Zod extract schema (`extractSchemas.us`), and its pure diff function. The pipeline stages (watch, convert, extract, diff, approve, publish) look the market up in that registry and never import `src/markets/us` directly. Source adapters sit behind `fetchArtifact(source)`, and only `http_pdf` exists. Codes are `{ system, code, display? }`, and the US schema checks the format of CPT, HCPCS, ICD-10-CM, and ICD-10-PCS codes. `src/markets/in/README.md` lists the steps to add India. No India code, payer, source, or form exists.

### How a policy moves through Anumat

1. A check fetches the PDF, stores it at `pdf/<sha256>.pdf`, and locks the source row. It inserts an artifact only when the SHA-256 differs from the latest artifact for that source. The same PDF never creates a new artifact, document, or version.
2. anydoc converts the PDF locally. When pages need OCR, Firecrawl Parse converts it if `FIRECRAWL_API_KEY` is set. Without the key, that document fails with `ocr_not_configured` and nothing else is affected.
3. Triage reads the document outline and picks the rule sections. Extract reads those sections by id and calls `save_extraction`. Mastra validates the tool input against `extractSchemas.us`, so invalid output goes back to the model with field-level errors.
4. `proposeVersion` parses the extraction with the market schema again before it writes anything. It supersedes any open proposal for the policy, stores the new version as `proposed`, and stores the change set against the latest approved version.
5. With a live model, the diff mode writes a reviewer summary and the review mode records findings on the diff. Both steps are best effort.
6. A person approves or rejects the proposal. Approval assigns the next version number and requires that the proposal's base is still the latest approved version.
7. `GET /v1/policies/:policyKey` serves approved versions only.

Every step converges when it runs again. A check after a failure resumes from the stored artifact or document. Postgres enforces one open proposal per policy, one version per document, required fields for each status, and triggers that reject any change to an approved version or a stored change set.

### Agent modes and token use

One `AgentController` per market runs four modes on a shared agent. Each job runs in its own session with the controller's built-in tools disabled. Tools take ids and refuse ids that are not part of the job, so text inside a PDF cannot redirect them.

| Mode | Model | Tools | Job |
| --- | --- | --- | --- |
| `triage` | `ANUMAT_CHEAP_MODEL` | `get_policy_document`, `save_triage` | Reads the outline, rejects documents that are not policies, and picks rule sections. |
| `extract` | `ANUMAT_STRONG_MODEL` | `get_policy_document`, `save_extraction` | Reads the chosen sections and saves the extraction. |
| `diff` | `ANUMAT_CHEAP_MODEL` | `get_approved_version`, `save_diff` | Summarizes the computed change set for the reviewer. |
| `review` | `ANUMAT_STRONG_MODEL` | `get_policy_document`, `save_diff` | Checks each change against the source sections and records findings. |

Documents never appear in prompts or tool definitions. The markdown stays in the BlobStore. `get_policy_document` returns an outline three heading levels deep, then whole sections by id, up to 40,000 characters per call. Instructions and tool schemas are fixed per mode, so the prompt prefix caches. Only the task message and tool results vary. On the three live seed PDFs, `scripts/context-report.ts` measured what the triage and extract steps receive.

| Document | Characters | Sent to the model |
| --- | --- | --- |
| UHC Bariatric Surgery | 302,796 | 21,129 (7.0%) |
| UHC Obstructive and Central Sleep Apnea Treatment | 166,809 | 24,860 (14.9%) |
| Cigna Bariatric Surgery and Procedures | 401,362 | 30,591 (7.6%) |

The report replays a scripted model that reads the sections the triage heuristic picks. A live model can read more or fewer sections.

`ANUMAT_LLM_MODE=replay` swaps in that scripted model for development. It saves the golden fixture extraction for the three fixture policies and fails the run for any other policy.

## Evals

`pnpm eval` runs `evals/*.eval.ts` with `@mastra/evals/vitest`. It needs no network, database, or API key. The target is a one-step Mastra workflow that runs the production triage and extract job on each fixture in `evals/fixtures/`. Offline, the job replays the hand-written `candidate.json` through the real agent tools and is scored against the hand-written gold `expected.json`. See `evals/fixtures/README.md` for where each fixture came from.

| Scorer | Kind | Pass mark |
| --- | --- | --- |
| `schema-validity` | Gate. The saved extraction passes `extractSchemas.us`. | 1.0 for every case |
| `required-field-completeness` | Share of the fields the gold fills that the extraction also fills. | 0.9 |
| `code-overlap` | F1 of codes matched on system and code. | 0.85 |
| `criteria-similarity` | Token-overlap F1 between extracted and gold criteria. | 0.75 |
| `criteria-judge` | LLM judge of criteria meaning. It returns `notScorable` when the judge model has no key. | 0.7 |
| `diff-matches-gold` | Gate. The US diff reproduces `evals/fixtures/diffs/*/expected-changes.json`. | 1.0 |

A second case replays an extraction that breaks the US schema and expects the gate to fail. A schema change that rejects the candidates fails the main case. A schema change that accepts the broken extraction fails the second case. Either way `pnpm eval` exits 1.

To score the configured models instead of the replay, set `ANUMAT_EVAL_LIVE=1` and the provider key, then run `pnpm eval`.

## API

Every `/v1` route needs `Authorization: Bearer <key>`, with a key from `ANUMAT_API_KEYS`. The key's name is recorded as the approver. JSON uses snake_case. Errors return `{ "error": { "code", "message", "details", "request_id" } }`, and every response carries an `X-Request-Id` header. List routes take `limit` (1 to 100, default 20) and `cursor`, and return `{ items, next_cursor }`. A per-key limit of `RATE_LIMIT_PER_MINUTE` returns 429 with `Retry-After`. The limit lives in memory, per process.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Liveness. No auth. |
| `GET /ready` | Readiness. Checks Postgres and reports LLM mode and OCR key presence. No auth. |
| `POST /v1/payers`, `GET /v1/payers` | Register and list payers. The body is `{ name, slug, market: "us" }`. |
| `POST /v1/sources`, `GET /v1/sources`, `GET /v1/sources/:id` | Register and read policy sources. The body is `{ payer_id, title, source_url, policy_slug?, check_interval_hours?, enabled? }`. The policy key is `<payer slug>.<policy slug>`. |
| `POST /v1/sources/:id/check` | Runs one check now and returns the watch run, the version, and the diff. |
| `GET /v1/policies/:policyKey` | Latest approved version, with its rules. |
| `GET /v1/policies/:policyKey/versions` | Approved versions, newest first. |
| `GET /v1/policies/:policyKey/versions/:version` | One approved version by number. |
| `GET /v1/versions` | Review queue. Filters are `status` and `policy_key`. |
| `GET /v1/versions/:id` | One version in any status, with its `diff_id`. |
| `POST /v1/versions/:id/approve` | Publishes a proposed version. |
| `POST /v1/versions/:id/reject` | Rejects a proposed version. The body is `{ reason }`. |
| `GET /v1/diffs/:id` | Change set, reviewer summary, and review findings. |

```bash
KEY=your-key
curl -s -X POST http://127.0.0.1:4471/v1/sources/$SOURCE_ID/check -H "authorization: Bearer $KEY"
curl -s http://127.0.0.1:4471/v1/policies/uhc.bariatric-surgery -H "authorization: Bearer $KEY"
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | none | Postgres connection string. Required. |
| `ANUMAT_API_KEYS` | none | Comma-separated `name:key` pairs. Keys need 16 or more characters. Required. |
| `TEST_DATABASE_URL` | `postgres://anumat:anumat@127.0.0.1:5432/anumat_test` | Database for `pnpm test`. |
| `HOST`, `PORT` | `127.0.0.1`, `4471` | Listen address. |
| `LOG_LEVEL` | `info` | Pino log level. Logs are JSON lines. |
| `RATE_LIMIT_PER_MINUTE` | `120` | Requests per key per minute. |
| `ANUMAT_DATA_DIR` | `./data/policies` | Where PDFs and markdown are stored. |
| `ANUMAT_STORAGE` | `local` | `local`, or `s3` for the stub that reports `storage_not_configured`. |
| `ANUMAT_LLM_MODE` | `live` | `live` uses the model router. `replay` uses the scripted fixture model. |
| `ANUMAT_STRONG_MODEL` | `anthropic/claude-sonnet-4-5` | Model for extract and review. Any Mastra model router id. |
| `ANUMAT_CHEAP_MODEL` | `anthropic/claude-haiku-4-5` | Model for triage and diff. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | none | Provider keys. The model router reads the key for the configured provider. |
| `FIRECRAWL_API_KEY` | none | Enables Firecrawl Parse for PDFs that need OCR. |
| `FIRECRAWL_API_URL` | `https://api.firecrawl.dev` | Firecrawl endpoint, for a self-hosted Firecrawl. |
| `ANUMAT_EVAL_LIVE` | unset | Set to `1` so `pnpm eval` scores the configured models. Otherwise the evals replay the fixtures. |

## Seed sources

`pnpm db:seed` registers these public PDFs. Each URL returned HTTP 200 with `application/pdf` on 2026-09-28, and anydoc converted each one without OCR.

| Policy key | Title | URL |
| --- | --- | --- |
| `uhc.bariatric-surgery` | Bariatric Surgery | https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/bariatric-surgery.pdf |
| `uhc.obstructive-sleep-apnea-treatment` | Obstructive and Central Sleep Apnea Treatment | https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/obstructive-sleep-apnea-treatment.pdf |
| `cigna.bariatric-surgery` | Bariatric Surgery and Procedures | https://static.cigna.com/assets/chcp/pdf/coveragePolicies/medical/mm_0051_coveragepositioncriteria_bariatric_surgery.pdf |

Aetna publishes its clinical policy bulletins as HTML pages, so the `http_pdf` adapter cannot fetch them. No Aetna source is seeded.

## What this MVP does not do

- India. There is no `in` market, payer, source, IRDAI form, or cashless flow.
- Claim submission, clearinghouse connections, or portal prior-auth submission.
- Source adapters other than `http_pdf`, and a working S3 client.
- A queue. A check runs inside the request, and `pnpm watch` runs sources one at a time. Two checks of the same source at once can repeat model calls, but they cannot create duplicate artifacts or versions.
- OpenAPI output, key rotation, and roles. Every key can approve.

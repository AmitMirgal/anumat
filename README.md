# Anumat

Anumat takes insurance policy documents and returns structured coverage rules. It tracks each change, waits for a person to approve it, and serves the approved rules from a versioned API. It does not check individual patients.

This repository is the US market. India is a seam for a later pack, not a second set of rules inside the core. Anumat is a separate product from Pramaan.

Code in a directory named `ee/` uses the enterprise license. The rest of this repository is Apache 2.0. Third-party code keeps its own license. Install a client without cloning the repo, or run the API yourself.

## Install a client

TypeScript, from npm:

```bash
npm install @anumat/js
```

```typescript
import { createAnumatClient } from '@anumat/js';

const anumat = createAnumatClient({
  baseUrl: 'http://127.0.0.1:4471',
  apiKey: 'your-api-key',
});
const page = await anumat.payers.list.query({ limit: 20 });
```

Python, from PyPI:

```bash
pip install anumat-py
```

```python
from anumat_py import AnumatClient

client = AnumatClient("http://127.0.0.1:4471", "your-api-key")
page = client.list_payers()
```

This repository does not publish either package.

## Run it yourself

You need Node 24 (see `.nvmrc`, install it with nvm), pnpm 12 (enable it with Corepack), uv, and PostgreSQL 16.

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

3. Install, generate the Prisma client, and start the API.

   ```bash
   pnpm install
   pnpm turbo db:generate
   pnpm turbo dev
   ```

   `pnpm dev` starts the same API. It listens on `http://127.0.0.1:4471`.

   | URL | What it is |
   | --- | --- |
   | `http://127.0.0.1:4471/trpc` | tRPC endpoint for the TypeScript client |
   | `http://127.0.0.1:4471/api/v1` | REST API generated from the same router |
   | `http://127.0.0.1:4471/api/v1/openapi.json` | OpenAPI document |
   | `http://127.0.0.1:4471/health` | Liveness. No auth. |

4. To register the three verified US policy sources, run `pnpm db:seed`.

5. To run the whole loop once over HTTP, run `pnpm demo`. It needs network access to `uhcprovider.com`.

Without the API key for the configured provider, a check still fetches, stores, and converts the PDF. The run then stops with `llm_not_configured`, which names that provider's variable. Google models read `GOOGLE_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`. Grok models read `XAI_API_KEY`. An Anthropic key is required only when a configured model id starts with `anthropic/`. `ANUMAT_LLM_MODE=replay` does not call a provider.

## Self-host (one command)

Docker is the only install requirement.

```bash
curl -fsSL https://raw.githubusercontent.com/AmitMirgal/anumat/main/install.sh | sh
```

To read the script before you run it, save it, review it, then run it.

```bash
curl -fsSL https://raw.githubusercontent.com/AmitMirgal/anumat/main/install.sh -o install.sh
less install.sh
sh install.sh
```

The installer does this work.

- It creates `~/anumat`.
- It generates an API key and a database password in `~/anumat/.env`.
- It pulls the image.
- It starts Postgres and the API at http://127.0.0.1:4471.
- It prints the API key once.

| Variable | Default | Effect |
| --- | --- | --- |
| `ANUMAT_DIR` | `$HOME/anumat` | Directory for Compose and `.env` |
| `ANUMAT_VERSION` | `latest` | Image tag to run |
| `ANUMAT_REF` | `main` | Git ref for the installer and the Compose file |

Set an LLM key in `~/anumat/.env`, for example `ANTHROPIC_API_KEY`. Then reload the API from that directory.

```bash
cd ~/anumat
docker compose up -d
```

Install `@anumat/js` and call the API with the printed key.

```typescript
import { createAnumatClient } from '@anumat/js';

const anumat = createAnumatClient({
  baseUrl: 'http://127.0.0.1:4471',
  apiKey: 'your-api-key',
});
```

To upgrade, run the installer again. A second run keeps the existing API key and database password.

To follow the API logs, run `docker compose logs -f api` in `~/anumat`.

To stop Postgres and the API, run `docker compose down` in `~/anumat`.

To uninstall and delete the database and the policy files, run `docker compose down -v` in `~/anumat`.

The API listens on `127.0.0.1`. To expose it beyond localhost, put an HTTPS reverse proxy in front of it.

### Run from source (contributors)

Clone the repository and build the image from that checkout.

```bash
git clone https://github.com/AmitMirgal/anumat && cd anumat
pnpm selfhost:init
pnpm selfhost:up
```

`pnpm selfhost:init` copies `.env.example` to `.env` when `.env` is absent. It replaces the placeholder API key. It adds `POSTGRES_PASSWORD` when that value is absent or empty. It leaves a key or a password that is already set. The script prints the API key. Keep that key private.

Without pnpm, run `bash scripts/selfhost-init.sh`, then run `docker compose up -d --build`.

Add an LLM key in `.env`, for example `ANTHROPIC_API_KEY`, and add `FIRECRAWL_API_KEY`. Without the LLM key, a check records `llm_not_configured`.

To update a checkout, run `git pull && pnpm selfhost:up`.

To stop the stack, run `pnpm selfhost:down`.

`docker compose down -v` deletes the Postgres data and the policy files.

### Publish the server image

From `main`, run `pnpm release:server`. The script reads the version in `apps/api/package.json`, asks you to type that version, and pushes the tag `server@` plus that version. The tag push publishes `ghcr.io/amitmirgal/anumat`. After the first push, set that GHCR package to Public once.

## Repository map

| Path | Package | What belongs there | Publish |
| --- | --- | --- | --- |
| `apps/api` | `@anumat/api` | Hono app, `/v1` routes, tRPC mount, API-key auth, `createApp` | Internal |
| `packages/core` | `@anumat/core` | Errors, pagination, change shape, market id, plug-in interfaces | Internal |
| `packages/markets` | `@anumat/markets` | Registry, US schema, US diff, US seeds. `in/` is a README | Internal |
| `packages/db` | `@anumat/db` | Prisma schema, migrations, generated client | Internal |
| `packages/engine` | `@anumat/engine` | Fetch, convert, extract, diff, jobs, agent, storage, catalog, versions | Internal |
| `packages/contract` | `@anumat/contract` | tRPC router and shared Zod schemas | Internal |
| `packages/tsconfig` | `@anumat/tsconfig` | Shared TypeScript presets | Internal |
| `packages/sdk-js` | `@anumat/js` | Typed tRPC client for npm | Public |
| `packages/sdk-python` | `anumat-py` | Python client for PyPI, a uv workspace member | Public |
| `apps/api/src/ee/` |  | Enterprise license note and the license-key check for the API. No other enterprise features yet | Separate license |

## Dependency direction

```
core  <-  markets  <-  engine  ->  db
core  <-  contract
apps/api  ->  engine, contract, db, core
sdk-js  ->  contract (types only, bundled at build)
sdk-python  ->  apps/api openapi.json (build order only)
any ee/ directory  ->  free code. Never the other way.
```

Packages do not import `apps/`. Free code never imports from a directory named `ee/`.

## API

tRPC is at `/trpc`. The TypeScript client uses it, so the server and the client share the router type.

REST and OpenAPI are at `/api/v1`. Other languages, including the Python client, use that. Both come from the same tRPC router. `GET /api/v1/openapi.json` serves the document.

The older `/v1` routes are still there, with the same paths and JSON. Every `/v1` and `/api/v1` route needs `Authorization: Bearer <key>`, with a key from `ANUMAT_API_KEYS`. The key's name is recorded as the approver. JSON uses snake_case. `/v1` errors return `{ "error": { "code", "message", "details", "request_id" } }`, and every `/v1` response carries an `X-Request-Id` header. List routes take `limit` (1 to 100, default 20) and `cursor`, and return `{ items, next_cursor }`. A per-key limit of `RATE_LIMIT_PER_MINUTE` returns 429 with `Retry-After`. The limit lives in memory, per process.

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

The REST paths under `/api/v1` match those `/v1` paths. tRPC procedure names are the nested names in `@anumat/contract`, such as `payers.list` and `versions.approve`.

```bash
KEY=your-key
curl -s -X POST http://127.0.0.1:4471/v1/sources/$SOURCE_ID/check -H "authorization: Bearer $KEY"
curl -s http://127.0.0.1:4471/v1/policies/uhc.bariatric-surgery -H "authorization: Bearer $KEY"
```

## Free and enterprise

Anything inside a directory named `ee/`, anywhere in this repository, is under the Anumat Enterprise Edition License in [apps/api/src/ee/LICENSE.md](apps/api/src/ee/LICENSE.md). Today that directory is `apps/api/src/ee/`. Everything else in this repository is under the Apache License 2.0 in [LICENSE.md](LICENSE.md). Third-party code keeps its own license.

`apps/api/src/ee/` holds the enterprise license note and the license-key check. It has no other enterprise features yet. Enterprise code plugs in through `createApp({ plugins })` and the interfaces in `packages/core/src/plugins.ts`. Free code never imports from any `ee/` directory. Enterprise code may import free code.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm turbo build` | Builds packages in dependency order, then writes `openapi.json` and the clients. |
| `pnpm turbo dev` | Starts the API on port 4471 and restarts it when a file changes. `pnpm dev` does the same. |
| `pnpm start` | Starts the API without file watching. |
| `pnpm turbo db:generate` | Generates the Prisma client. `pnpm db:generate` does the same. |
| `pnpm db:migrate` | Applies `packages/db/prisma/migrations` to `DATABASE_URL`. |
| `pnpm db:seed` | Registers UnitedHealthcare, Cigna, and three policy PDFs. It skips rows that already exist. |
| `pnpm watch` | Checks every enabled source whose `check_interval_hours` has passed, then exits. |
| `pnpm turbo test` | Runs unit and integration tests. `pnpm test` does the same. |
| `pnpm turbo typecheck` | Type-checks every package. |
| `pnpm turbo lint` | Lints the Python package with Ruff. |
| `pnpm eval` | Runs the engine evals offline. It exits 1 on a schema-validity regression. |
| `pnpm demo` | Registers a payer and the live UHC Bariatric Surgery PDF, then checks, diffs, approves, and reads it over HTTP. |
| `pnpm selfhost:init` | Creates `.env` when it is missing, replaces a placeholder API key, adds a missing Postgres password, and prints the API key. |
| `pnpm selfhost:up` | Starts Postgres, runs migrations, and starts the API. |
| `pnpm selfhost:down` | Stops the API and Postgres. |
| `pnpm selfhost:logs` | Follows the API logs. |
| `pnpm release:engine` | Publishes `@anumat/engine` to npm. |
| `pnpm release:engine-py` | Publishes `anumat-engine` to PyPI. |
| `pnpm release:anumat` | Publishes `@anumat/js` to npm. |
| `pnpm release:anumat-py` | Publishes `anumat-py` to PyPI. |
| `pnpm release:server` | Tags `server@` plus the version in `apps/api/package.json` and pushes that tag. |
| `pnpm turbo test --filter=@anumat/markets` | Runs one package. Replace the filter with any package name. |

`pnpm --filter @anumat/engine context-report` reports how many characters of each converted document the agent reads.

## Releasing

Bump `@anumat/js` or `@anumat/engine` with changesets. Bump `anumat-py` with `pnpm version:py`. Merge that branch to `main`. Publish from `main`.

1. For `@anumat/js` or `@anumat/engine`, run `pnpm changeset`. Then run `pnpm changeset version`.
2. For `anumat-py`, run `pnpm version:py`.
3. Open a pull request.
4. Squash-merge the pull request.
5. Run `git checkout main && git pull`.
6. Run `pnpm release:anumat`, `pnpm release:anumat-py`, `pnpm release:engine`, or `pnpm release:engine-py`.

`pnpm release:anumat` publishes `@anumat/js` from a clean `main` that matches GitHub. It builds, runs the tests, prints the npm dry run, and waits until you type the version.

`pnpm release:anumat-py` publishes `anumat-py` from a clean `main` that matches GitHub. It builds the wheel, checks that the wheel imports, and publishes with `uv publish`. `PYPI_TOKEN` comes from the environment.

`pnpm release:engine` publishes `@anumat/engine` from a clean `main` that matches GitHub. It builds, runs the tests, prints the `npm pack --dry-run` file list, and waits until you type the version. Bump `@anumat/engine` with changesets first, the same way as `@anumat/js`.

`pnpm release:engine-py` publishes `anumat-engine` from a clean `main` that matches GitHub. It sets the Python package version to the `@anumat/engine` version, runs the package tests, and builds one wheel for each platform with Bun. It publishes those wheels with `uv publish`. `PYPI_TOKEN` comes from the environment. The script commits the version bump, creates the local tag `anumat-py@<version>`, and prints `git push origin main && git push origin anumat-py@<version>`. It does not push.

`npm login` stores the npm token in `~/.npmrc`. Store `PYPI_TOKEN` in `~/.zshrc`. Keep both tokens out of the repo and out of `.env`.

## Contributing

Do not add PHI or real patient data, including test fixtures. Public policy PDFs and synthetic examples only.

`packages/core` stays market-neutral. US rules stay in `packages/markets`. `packages/markets/src/in` stays a README until an India pack is a real decision.

Imports flow one way, as in the diagram above. A package that needs a type from a neighbor imports that package. It does not reach back.

## Architecture

```mermaid
flowchart TD
  client["API client or reviewer"] -->|Bearer API key| api["Hono API"]
  cron["pnpm watch from cron"] --> check
  api -->|"POST /v1/sources/:id/check"| check["checkSource"]
  check --> adapter["http_pdf source adapter"]
  adapter -->|"PDF bytes, SHA-256"| blobs[("BlobStore, local directory or S3-compatible bucket")]
  check --> convert["anydoc, or Firecrawl Parse when pages need OCR"]
  convert --> triage
  subgraph agent["AgentController, one session per job"]
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
  subgraph markets["Market registry"]
    us["us market"]
    india["in market, README only"]
  end
  propose -.->|"marketFor(source.market)"| markets
  extract -.->|"save_extraction input schema"| markets
```

### The market registry

`market` is a column on payers, policy sources, and policy versions, and a literal in each extraction. Composite foreign keys keep those copies equal. `packages/markets/src/registry.ts` maps each built-in market to its `schemaId`, its Zod extract schema, and its pure diff function. `registerMarket` lets a later pack add a market without editing this package. The pipeline looks the market up with `marketFor` and does not import `packages/markets/src/us` directly. Source adapters sit behind `fetchArtifact(source)`, and only `http_pdf` exists. Codes are `{ system, code, display? }`, and the US schema checks the format of CPT, HCPCS, ICD-10-CM, and ICD-10-PCS codes. `packages/markets/src/in/README.md` lists the steps that were written for an India market. No India code, payer, source, or form exists. The Prisma `Market` enum is still only `us`.

### How a policy moves through Anumat

1. A check fetches the PDF, stores it at `pdf/<sha256>.pdf`, and locks the source row. It inserts an artifact only when the SHA-256 differs from the latest artifact for that source. The same PDF never creates a new artifact, document, or version.
2. anydoc converts the PDF locally. When pages need OCR, Firecrawl Parse converts it if `FIRECRAWL_API_KEY` is set. Without the key, that document fails with `ocr_not_configured` and nothing else is affected.
3. Triage reads the document outline and picks the rule sections. Extract reads those sections by id and calls `save_extraction`. The agent validates the tool input against the market schema, so invalid output goes back to the model with field-level errors.
4. `proposeVersion` parses the extraction with the market schema again before it writes anything. It supersedes any open proposal for the policy, stores the new version as `proposed`, and stores the change set against the latest approved version.
5. With a live model, the diff mode writes a reviewer summary and the review mode records findings on the diff. Both steps are best effort.
6. A person approves or rejects the proposal. Approval assigns the next version number and requires that the proposal's base is still the latest approved version. The free `ReviewPolicy` allows that single approval.
7. `GET /v1/policies/:policyKey` serves approved versions only.

Every step converges when it runs again. A check after a failure resumes from the stored artifact or document. `packages/db/prisma/schema.prisma` defines the tables, relations, foreign-key indexes, and the partial unique index for one open proposal per policy. Unique columns still enforce one version per document and one diff per version. The init migration also adds the checks and immutability triggers Prisma cannot represent. After a schema change, create the migration from `packages/db` with `pnpm --filter @anumat/db exec prisma migrate dev --name <name>`, then run `pnpm db:generate`.

### Agent modes and token use

One `AgentController` per market runs four modes on a shared agent. Each job runs in its own session with the controller's built-in tools disabled. Tools take ids and refuse ids that are not part of the job, so text inside a PDF cannot redirect them.

| Mode | Model | Tools | Job |
| --- | --- | --- | --- |
| `triage` | `ANUMAT_CHEAP_MODEL` | `get_policy_document`, `save_triage` | Reads the outline, rejects documents that are not policies, and picks rule sections. |
| `extract` | `ANUMAT_STRONG_MODEL` | `get_policy_document`, `save_extraction` | Reads the chosen sections and saves the extraction. |
| `diff` | `ANUMAT_CHEAP_MODEL` | `get_approved_version`, `save_diff` | Summarizes the computed change set for the reviewer. |
| `review` | `ANUMAT_STRONG_MODEL` | `get_policy_document`, `save_diff` | Checks each change against the source sections and records findings. |

Documents never appear in prompts or tool definitions. The markdown stays in the BlobStore. `get_policy_document` returns an outline three heading levels deep, then whole sections by id, up to 40,000 characters per call. Instructions and tool schemas are fixed per mode, so the prompt prefix caches. Only the task message and tool results vary. On the three live seed PDFs, `packages/engine/scripts/context-report.ts` measured what the triage and extract steps receive.

| Document | Characters | Sent to the model |
| --- | --- | --- |
| UHC Bariatric Surgery | 302,796 | 21,129 (7.0%) |
| UHC Obstructive and Central Sleep Apnea Treatment | 166,809 | 24,860 (14.9%) |
| Cigna Bariatric Surgery and Procedures | 401,362 | 30,591 (7.6%) |

The report replays a scripted model that reads the sections the triage heuristic picks. A live model can read more or fewer sections.

`ANUMAT_LLM_MODE=replay` swaps in that scripted model for development. It saves the golden fixture extraction for the three fixture policies and fails the run for any other policy.

## Evals

`pnpm eval` runs `packages/engine/evals/*.eval.ts`. It needs no network, database, or API key. The target is a one-step workflow that runs the production triage and extract job on each fixture in `packages/engine/evals/fixtures/`. Offline, the job replays the hand-written `candidate.json` through the real agent tools and is scored against the hand-written gold `expected.json`. See `packages/engine/evals/fixtures/README.md` for where each fixture came from.

| Scorer | Kind | Pass mark |
| --- | --- | --- |
| `schema-validity` | Gate. The saved extraction passes the US schema. | 1.0 for every case |
| `required-field-completeness` | Share of the fields the gold fills that the extraction also fills. | 0.9 |
| `code-overlap` | F1 of codes matched on system and code. | 0.85 |
| `criteria-similarity` | Token-overlap F1 between extracted and gold criteria. | 0.75 |
| `criteria-judge` | LLM judge of criteria meaning. It returns `notScorable` when the judge model has no key. | 0.7 |
| `diff-matches-gold` | Gate. The US diff reproduces `packages/engine/evals/fixtures/diffs/*/expected-changes.json`. | 1.0 |

A second case replays an extraction that breaks the US schema and expects the gate to fail. A schema change that rejects the candidates fails the main case. A schema change that accepts the broken extraction fails the second case. Either way `pnpm eval` exits 1.

To score the configured models instead of the replay, set `ANUMAT_EVAL_LIVE=1` and the provider key, then run `pnpm eval`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | none | Postgres connection string. Required. |
| `ANUMAT_API_KEYS` | none | Comma-separated `name:key` pairs. Keys need 16 or more characters. Required. |
| `TEST_DATABASE_URL` | `postgres://anumat:anumat@127.0.0.1:5432/anumat_test` | Database for `pnpm test`. |
| `HOST`, `PORT` | `127.0.0.1`, `4471` | Listen address. |
| `LOG_LEVEL` | `info` | Pino log level. Logs are JSON lines. |
| `RATE_LIMIT_PER_MINUTE` | `120` | Requests per key per minute. |
| `ANUMAT_DATA_DIR` | `./data/policies` | Directory for PDFs and markdown when `ANUMAT_STORAGE` is `local`. |
| `ANUMAT_STORAGE` | `local` | `local` writes `ANUMAT_DATA_DIR`. `s3` writes one S3-compatible bucket. |
| `ANUMAT_S3_ENDPOINT` | none | Custom S3 endpoint. Set it for Supabase Storage and for Google Cloud Storage. Omit it for Amazon S3. |
| `ANUMAT_S3_REGION` | none | Region. Required when `ANUMAT_STORAGE` is `s3`. Supabase often uses `us-east-1`. Google Cloud Storage uses `auto`. |
| `ANUMAT_S3_BUCKET` | none | Bucket name. Required when `ANUMAT_STORAGE` is `s3`. |
| `ANUMAT_S3_ACCESS_KEY_ID` | none | Access key. Required when `ANUMAT_STORAGE` is `s3`. |
| `ANUMAT_S3_SECRET_ACCESS_KEY` | none | Secret key. Required when `ANUMAT_STORAGE` is `s3`. |
| `ANUMAT_LLM_MODE` | `live` | `live` uses the model router. `replay` uses the scripted fixture model and does not read a provider key. |
| `ANUMAT_STRONG_MODEL` | `anthropic/claude-sonnet-4-5` | Model for extract and review. A model router id, `provider/model`. Google: `google/gemini-2.5-pro`. Grok: `xai/grok-4.3`. |
| `ANUMAT_CHEAP_MODEL` | `anthropic/claude-haiku-4-5` | Model for triage and diff. Google: `google/gemini-2.5-flash`. Grok: `xai/grok-build-0.1`. |
| `ANTHROPIC_API_KEY` | none | Key for `anthropic/*`. |
| `OPENAI_API_KEY` | none | Key for `openai/*`. |
| `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | none | Either key works for `google/*`. |
| `XAI_API_KEY` | none | Key for `xai/*` (Grok). |
| `FIRECRAWL_API_KEY` | none | Enables Firecrawl Parse for PDFs that need OCR. |
| `FIRECRAWL_API_URL` | `https://api.firecrawl.dev` | Firecrawl endpoint, for a self-hosted Firecrawl. |
| `ANUMAT_EVAL_LIVE` | unset | Set to `1` so `pnpm eval` scores the configured models. Otherwise the evals replay the fixtures. |

The router accepts any provider id it already ships, including Anthropic, OpenAI, Google, and xAI. There is no `serum` provider. A Serum model would be the string `serum/<model>`, and Anumat does not add that provider.

A custom endpoint uses path-style requests. The client sends a checksum only when the operation requires one. Supabase Storage and the Google Cloud Storage interoperability endpoint accept that request.

Local disk:

```bash
ANUMAT_STORAGE=local
ANUMAT_DATA_DIR=./data/policies
```

Supabase Storage:

```bash
ANUMAT_STORAGE=s3
ANUMAT_S3_ENDPOINT=https://abcdefghijklmnopqrst.supabase.co/storage/v1/s3
ANUMAT_S3_REGION=us-east-1
ANUMAT_S3_BUCKET=policies
ANUMAT_S3_ACCESS_KEY_ID=your-access-key-id
ANUMAT_S3_SECRET_ACCESS_KEY=your-secret-access-key
```

Google Cloud Storage, S3 interoperability:

```bash
ANUMAT_STORAGE=s3
ANUMAT_S3_ENDPOINT=https://storage.googleapis.com
ANUMAT_S3_REGION=auto
ANUMAT_S3_BUCKET=anumat-policies
ANUMAT_S3_ACCESS_KEY_ID=your-hmac-access-id
ANUMAT_S3_SECRET_ACCESS_KEY=your-hmac-secret
```

## Seed sources

`pnpm db:seed` registers these public PDFs. Each URL returned HTTP 200 with `application/pdf` on 2026-09-28, and anydoc converted each one without OCR.

| Policy key | Title | URL |
| --- | --- | --- |
| `uhc.bariatric-surgery` | Bariatric Surgery | https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/bariatric-surgery.pdf |
| `uhc.obstructive-sleep-apnea-treatment` | Obstructive and Central Sleep Apnea Treatment | https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/obstructive-sleep-apnea-treatment.pdf |
| `cigna.bariatric-surgery` | Bariatric Surgery and Procedures | https://static.cigna.com/assets/chcp/pdf/coveragePolicies/medical/mm_0051_coveragepositioncriteria_bariatric_surgery.pdf |

Aetna publishes its clinical policy bulletins as HTML pages, so the `http_pdf` adapter cannot fetch them. No Aetna source is seeded.

## What this MVP does not do

- India. There is no `in` market implementation, payer, source, IRDAI form, or cashless flow.
- Claim submission, clearinghouse connections, or portal prior-auth submission.
- Source adapters other than `http_pdf`.
- A queue. A check runs inside the request, and `pnpm watch` runs sources one at a time. Two checks of the same source at once can repeat model calls, but they cannot create duplicate artifacts or versions.
- Key rotation and roles. Every key can approve.

## License

See `LICENSE.md` and `apps/api/src/ee/LICENSE.md`.

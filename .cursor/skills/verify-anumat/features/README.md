# Anumat verification map

This directory is the maintained source for verifying the user-facing behavior of the Anumat HTTP API. There is no web UI. Read this index before driving the API, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-anumat/verify.sh launch` and require the `ready url=` line.
- Run `.cursor/skills/verify-anumat/verify.sh doctor` and require `doctor ok` for that same URL.
- Source `.cursor/skills/verify-anumat/run/state.env` for `BASE_URL`, `SLUG`, `PORT`, and `DATA_DIR`.
- Export `ANUMAT_VERIFY_KEY=anumat-local-verify-key` and send `Authorization: Bearer $ANUMAT_VERIFY_KEY` on every `/v1` request.
- The server is in `ANUMAT_LLM_MODE=replay`. `GET /ready` reports `llm_mode` `replay` and `database` `up`.
- Seed data may already include payers `cigna` and `uhc` and their three policy sources. Verification slugs stay `verify-<timestamp>`.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Treat every command as literal aside from `$BASE_URL`, `$SLUG`, `$ANUMAT_VERIFY_KEY`, and ids returned by an earlier step in the same recipe.
- Save each response body and the HTTP status. The status file is the curl `-w '%{http_code}'` value with no other text.
- Page with `limit=100`. When `next_cursor` is non-null, request the next page before deciding a row is missing.
- Restore nothing by calling a delete route. Anumat has no delete route. Process cleanup is `verify.sh cleanup`.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the request and the resulting state, not only the last response.
- HTTP proof includes the method, path, request body, status, and response body.
- Mutation proof includes a later GET that shows the stored row.
- Record the feature id and the entry point used with every artifact.
- Write the artifact to `.cursor/skills/verify-anumat/evidence/<feature-id>.json` before cleanup.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with HTTP` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Register a payer](./register-payer.md) covers create, list, conflict, validation, and a missing bearer key.
- [Register a policy source](./register-source.md) covers create, read by id, list, unknown payer, and URL conflict.
- [Check a source](./check-source.md) covers a live PDF check, the unpublished proposal, and an unchanged recheck.
- [Review a version](./review-version.md) covers the review queue, one version, and its diff.
- [Publish or reject a version](./publish-version.md) covers approval, the published policy read, and rejection.

# Review a version

Review a version lets an API client list the queue, open one version in any status, and read the change set stored for that version.

## Sub-features

- `review-queue` lists versions filtered by status and policy key.
- `review-open` returns one version and its `diff_id`.
- `review-diff` returns the change set for that diff id.

## How to get to it (user POV)

- `GET /v1/versions?status=proposed&policy_key=<policy key>` with the bearer key.
- `GET /v1/versions/:id` with the bearer key.
- `GET /v1/diffs/:id` with the bearer key.

## Driving it with HTTP

Preconditions:

- Doctor printed `doctor ok` for `$BASE_URL`, including `llm_mode` `replay`.
- [Check a source](./check-source.md) has produced a proposed version for `$SLUG.bariatric-surgery`. Keep `version_id` and `diff_id` from that check. If that check did not return `watch_run.outcome` `new_artifact`, stop and report the check's outcome. Do not insert a version any other way.

- **Queue.** Run `curl -sS -H "authorization: Bearer $ANUMAT_VERIFY_KEY" "$BASE_URL/v1/versions?status=proposed&policy_key=$SLUG.bariatric-surgery&limit=100"`. HTTP 200. `items` contains the `version_id` from the check, that item's `status` is `proposed`, and its `version` is null. Follow `next_cursor` if it is non-null before calling the id missing.
- **Open version.** `GET "$BASE_URL/v1/versions/$VERSION_ID"` with the bearer key. HTTP 200. `id` equals `version_id`, `policy_key` is `$SLUG.bariatric-surgery`, `status` is `proposed`, and `diff_id` equals the check's `diff.id`.
- **Read diff.** `GET "$BASE_URL/v1/diffs/$DIFF_ID"` with the bearer key. HTTP 200. `policy_key` is `$SLUG.bariatric-surgery`, `to_version_id` equals `version_id`, `from_version_id` is null, and `changes` includes an object whose `field` is `title`, `kind` is `changed`, and `after` is `Bariatric Surgery`.
- **Proof.** Write `.cursor/skills/verify-anumat/evidence/review-version.json` with the queue page that holds the id, the version body, and the diff body.

## Gotchas

- The queue is newest first. Filters are `status` and `policy_key`. A queue with no filter can hide the row past `limit` 20. Filter, then follow `next_cursor`.
- `GET /v1/versions/:id` is the route that adds `diff_id`. The queue items do not include it.
- With `llm_mode` `replay`, `summary` and `review` on the diff are null. The `changes` array is still the proof. Do not fail the journey for a null summary while `/ready` says replay.
- A proposed version's `version` number is null until approval. Do not expect `1` here.
- An unknown version id or diff id is HTTP 404 `not_found`. A non-UUID id is HTTP 400 `validation_failed`.
- This journey does not approve or reject. Leave the version `proposed` for [Publish or reject a version](./publish-version.md), or report that the version was already decided.

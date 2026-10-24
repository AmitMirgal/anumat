# Publish or reject a version

Publish or reject a version lets an API client approve a proposal and read it from the public policy URL, or reject it and see the policy stay unpublished.

## Sub-features

- `publish-hidden` shows a proposed policy is absent from the public URL.
- `publish-approve` approves the proposal and assigns version 1.
- `publish-read` returns that approved version from the policy URL.
- `publish-reject` rejects a different still-proposed version and keeps that policy unpublished.

## How to get to it (user POV)

- `GET /v1/policies/:policyKey` with the bearer key.
- `POST /v1/versions/:id/approve` with the bearer key and no body.
- `POST /v1/versions/:id/reject` with the bearer key and `{ "reason" }`.
- `GET /v1/policies/:policyKey/versions/1` with the bearer key after approval.

## Driving it with HTTP

Preconditions:

- Doctor printed `doctor ok` for `$BASE_URL`, including `llm_mode` `replay`.
- [Check a source](./check-source.md) has a proposed version for `$SLUG.bariatric-surgery`. Keep `version_id`. If the check outcome was not `new_artifact`, stop and report it.
- For `publish-reject`, a second proposed version must already exist on a different policy key from a second check. If it does not, run the reject bullets only after that check, and report the approve bullets separately. Do not reject the same id you need to approve.

- **Hidden before approval.** `GET "$BASE_URL/v1/policies/$SLUG.bariatric-surgery"` with the bearer key. HTTP 404. `error.code` is `policy_not_published`.
- **Approve.** Run `curl -sS -o "$RUN_DIR/drive/approve.json" -w '%{http_code}' -X POST "$BASE_URL/v1/versions/$VERSION_ID/approve" -H "authorization: Bearer $ANUMAT_VERIFY_KEY"`. HTTP 200. `status` is `approved`, `version` is `1`, `approved_by` is `verify`, and `id` is `version_id`.
- **Read published policy.** `GET "$BASE_URL/v1/policies/$SLUG.bariatric-surgery"` with the bearer key. HTTP 200. `version` is `1`, `version_id` equals the approved id, `approved_by` is `verify`, `source.title` is `Bariatric Surgery`, and `rules.policy_number` is `2026T0362RR` while `llm_mode` is `replay`.
- **Read version 1.** `GET "$BASE_URL/v1/policies/$SLUG.bariatric-surgery/versions/1"` with the bearer key. HTTP 200. `version_id` equals the approved id.
- **Reject a second proposal.** POST `$BASE_URL/v1/versions/$REJECT_VERSION_ID/reject` with body `{ "reason": "Criteria misread" }` and the bearer key. HTTP 200. `status` is `rejected` and `reject_reason` is `Criteria misread`. GET that policy key. HTTP 404 `policy_not_published`. POST approve on the rejected id. HTTP 409. `error.code` is `version_not_proposed`.
- **Proof.** Write `.cursor/skills/verify-anumat/evidence/publish-version.json` with the pre-approval 404, the approve body, and the published GET. Include the reject trio only when that second proposal was actually driven.

## Gotchas

- Approve sends no JSON body. Reject requires `reason` of 3 to 1000 characters. A short reason is `validation_failed` and leaves the version proposed.
- `approved_by` and `rejected_by` are the key name `verify`, not the bearer secret.
- The first approval of a policy key gets `version` 1. A later approval of a new proposal gets the next number only when its base is still the latest approved version. Otherwise approve returns HTTP 409 `stale_proposal`.
- Approving or rejecting a version that is not `proposed` returns HTTP 409 `version_not_proposed`. Approve and reject are different versions when both are under test.
- Only one proposed version is open for a policy key. A second check that creates a proposal supersedes the previous open proposal.
- `GET /v1/policies/:policyKey` never returns a proposed, rejected, or superseded version.
- Replay's published `rules.policy_number` is `2026T0362RR` for `Bariatric Surgery`. Do not require that number when `llm_mode` is `live`.
- Approved rows stay in the database. Cleanup will not delete them. Use a fresh `$SLUG` on the next run.

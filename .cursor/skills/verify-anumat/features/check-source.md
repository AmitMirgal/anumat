# Check a source

Check a source fetches the policy PDF, stores a new artifact when the bytes changed, and returns a proposed version. The proposal is not on the published policy URL until someone approves it.

## Sub-features

- `check-propose` runs one check and returns a proposed version.
- `check-unpublished` shows the policy is not published yet.
- `check-unchanged` runs the check again and keeps the same version when the PDF bytes match.

## How to get to it (user POV)

- `POST /v1/sources/:id/check` with the bearer key and an empty body.
- `GET /v1/policies/:policyKey` with the bearer key to see whether a version is public.

## Driving it with HTTP

Preconditions:

- Doctor printed `doctor ok` for `$BASE_URL`, including `llm_mode` `replay`.
- Register a payer `{ "name": "UnitedHealthcare", "slug": "$SLUG", "market": "us" }` and a source titled `Bariatric Surgery` with `policy_slug` `bariatric-surgery` and `source_url` `https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/bariatric-surgery.pdf?anumat-verify=$SLUG`, as in [Register a policy source](./register-source.md). Keep `source_id` and `policy_key` (`$SLUG.bariatric-surgery`).
- That source has not been checked yet in this database.

- **Check source.** Run `curl -sS --max-time 180 -o "$RUN_DIR/drive/check.json" -w '%{http_code}' -X POST "$BASE_URL/v1/sources/$SOURCE_ID/check" -H "authorization: Bearer $ANUMAT_VERIFY_KEY"`. Save the status to `$RUN_DIR/drive/check.status`. HTTP 200. `watch_run.outcome` is `new_artifact`, `watch_run.error` is null, `watch_run.artifact_id` is set, `version.status` is `proposed`, `version.version` is null, `version.policy_key` is `$SLUG.bariatric-surgery`, and `diff.id` is set. `version.rules.title` is `Bariatric Surgery`, `version.rules.payer` is `UnitedHealthcare`, and `version.rules.policy_number` is `2026T0362RR`.
- **Unpublished read.** `GET "$BASE_URL/v1/policies/$SLUG.bariatric-surgery"` with the bearer key. HTTP 404. `error.code` is `policy_not_published`.
- **Recheck.** POST the same check URL again with `--max-time 180`. HTTP 200. `watch_run.outcome` is `unchanged`, `watch_run.error` is null, and `version.id` equals the first check's `version.id`.
- **Proof.** Write `.cursor/skills/verify-anumat/evidence/check-source.json` with both check bodies and the 404 policy read. The second outcome `unchanged` is the side-effect check that the same PDF did not open a second version.

## Gotchas

- The check runs inside the request. Give curl at least 180 seconds. A short timeout is not a failed extraction.
- Replay still downloads and converts the real PDF. Do not replace the URL with a local stand-in. A failure to reach `uhcprovider.com` comes back as `watch_run.outcome` `error` and `watch_run.error.code` `fetch_failed`. Report that and stop. Do not retarget the source.
- Replay saves the fixture extraction only when the payer name and the source title match a fixture exactly: `UnitedHealthcare` / `Bariatric Surgery`, `UnitedHealthcare` / `Obstructive and Central Sleep Apnea Treatment`, or `Cigna` / `Bariatric Surgery and Procedures`. Any other title returns `watch_run.outcome` `error` and `error.code` `extraction_failed`. Do not rename the policy under test so the fixture matches.
- In replay, `version.rules.policy_number` `2026T0362RR` is the bariatric fixture. If `/ready` reports `llm_mode` `live`, do not require that policy number.
- Live mode with no provider key returns `watch_run.outcome` `error` and `error.code` `llm_not_configured`. This launch sets replay so the check does not need a provider key. Confirm `llm_mode` is `replay` before treating the fixture policy number as expected.
- The same bytes for the same source do not create another version. A new query string is a new source URL and a new artifact even when the PDF is the same file.
- A document that needs OCR and has no `FIRECRAWL_API_KEY` fails that source with `ocr_not_configured`. This launch leaves OCR unset. The bariatric PDF is expected to convert without it.
- `GET /v1/policies/:policyKey` stays 404 until approve. A proposed version in the check body is not publication.
- Checking the seeded `uhc` or `cigna` source writes a version onto that shared policy. Use the run-scoped URL instead. Versions cannot be deleted afterward.

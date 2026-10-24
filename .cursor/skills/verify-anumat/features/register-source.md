# Register a policy source

Register a policy source lets an API client attach an HTTP PDF URL to a payer, read that source back by id and from the source list, and see a conflict when the URL or policy key is already taken.

## Sub-features

- `source-create` saves a source and returns its policy key.
- `source-read` returns the same source from `GET /v1/sources/:id`.
- `source-list` shows that policy key on `GET /v1/sources`.
- `source-unknown-payer` rejects a payer id that is not registered.
- `source-conflict` rejects a second source with the same URL.

## How to get to it (user POV)

- `POST /v1/sources` with `{ "payer_id", "title", "source_url", "policy_slug"? }` and the bearer key.
- `GET /v1/sources/:id` with the bearer key.
- `GET /v1/sources` with the bearer key. Sources are ordered by policy key.

## Driving it with HTTP

Preconditions:

- Doctor printed `doctor ok` for `$BASE_URL`.
- A payer named `UnitedHealthcare` exists for `$SLUG`. Create it with `POST /v1/payers` body `{ "name": "UnitedHealthcare", "slug": "$SLUG", "market": "us" }` when this run has not already created that slug. HTTP 201. Keep `payer_id` from `id`.
- No source already uses `https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/bariatric-surgery.pdf?anumat-verify=$SLUG`.

- **Create source.** Run `curl -sS -o "$RUN_DIR/drive/source.json" -w '%{http_code}' -X POST "$BASE_URL/v1/sources" -H "authorization: Bearer $ANUMAT_VERIFY_KEY" -H 'content-type: application/json' -d '{"payer_id":"'"$PAYER_ID"'","title":"Bariatric Surgery","policy_slug":"bariatric-surgery","source_url":"https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-medical-drug/bariatric-surgery.pdf?anumat-verify='"$SLUG"'"}'` and save the status to `$RUN_DIR/drive/source.status`. HTTP 201. `policy_key` is `$SLUG.bariatric-surgery`, `market` is `us`, `adapter_type` is `http_pdf`, `enabled` is true, and `source_url` is the URL you sent.
- **Read source.** `GET "$BASE_URL/v1/sources/$SOURCE_ID"` with the bearer key. HTTP 200. `id`, `policy_key`, and `source_url` match the create body.
- **List sources.** `GET "$BASE_URL/v1/sources?limit=100"` with the bearer key, following `next_cursor` until the policy key appears or the cursor is null. HTTP 200 on every page. One item has `policy_key` `$SLUG.bariatric-surgery`.
- **Unknown payer.** POST a source whose `payer_id` is `11111111-1111-4111-8111-111111111111` and whose URL is `https://example.com/missing-'"$SLUG"'.pdf`. HTTP 404. `error.code` is `not_found`.
- **Duplicate URL.** POST the original source body again. HTTP 409. `error.code` is `conflict`.
- **Proof.** Write `.cursor/skills/verify-anumat/evidence/register-source.json` with the create body, the GET-by-id body, and the list item that shares that `id`. Do not call `POST /v1/sources/:id/check` in this journey.

## Gotchas

- `payer_id` has to be a UUID of an existing payer. A payer slug in that field is `validation_failed`, not a source.
- The policy key is `$SLUG.bariatric-surgery` when `policy_slug` is `bariatric-surgery`. Omitting `policy_slug` derives it from the title. The seeded key `uhc.bariatric-surgery` is a different payer; do not treat it as this run's source.
- `source_url` and `policy_key` are unique. The seeded PDFs already use the UHC and Cigna URLs without a query string. The `anumat-verify=$SLUG` query keeps this registration unique. Registration does not fetch the PDF.
- `market` on the source, when sent, has to be `us` and has to match the payer. `in` is rejected.
- There is no HTTP delete. Cleanup can remove this source only before a check stores a version.
- A 201 alone is not proof. Read the source by id after the list shows the policy key.

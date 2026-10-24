# Register a payer

Register a payer lets an API client create a US payer, see that payer on a later list, and tell a duplicate slug, an invalid body, and a missing key apart from a saved payer.

## Sub-features

- `payer-create` saves a name, slug, and market.
- `payer-list` shows the saved payer on `GET /v1/payers`.
- `payer-conflict` rejects a second payer with the same slug.
- `payer-invalid` rejects a slug or market the API does not accept.
- `payer-unauthorized` rejects a list call with no bearer key.

## How to get to it (user POV)

- `POST /v1/payers` with `{ "name", "slug", "market": "us" }` and `Authorization: Bearer $ANUMAT_VERIFY_KEY`.
- `GET /v1/payers` with the same header to see payers ordered by slug.

## Driving it with HTTP

Preconditions:

- Doctor printed `doctor ok` for `$BASE_URL`.
- `$SLUG` from `run/state.env` is not already a payer slug.
- `$RUN_DIR` is `.cursor/skills/verify-anumat/run` and `$ANUMAT_VERIFY_KEY` is `anumat-local-verify-key`.

- **Create payer.** Register this run's payer. Run `mkdir -p "$RUN_DIR/drive"` and `curl -sS -o "$RUN_DIR/drive/create.json" -w '%{http_code}' -X POST "$BASE_URL/v1/payers" -H "authorization: Bearer $ANUMAT_VERIFY_KEY" -H 'content-type: application/json' -d '{"name":"Verify Payer","slug":"'"$SLUG"'","market":"us"}' > "$RUN_DIR/drive/create.status"`. HTTP 201. The body `slug` is `$SLUG`, `name` is `Verify Payer`, `market` is `us`, and `id` is present.
- **List payers.** Read every page. Run `page=1; cursor=""; while true; do url="$BASE_URL/v1/payers?limit=100"; if [[ -n "$cursor" ]]; then url="${url}&cursor=${cursor}"; fi; curl -sS -o "$RUN_DIR/drive/list-${page}.json" -w '%{http_code}' -H "authorization: Bearer $ANUMAT_VERIFY_KEY" "$url" > "$RUN_DIR/drive/list-${page}.status"; cursor="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("next_cursor") or "")' "$RUN_DIR/drive/list-${page}.json")"; if [[ -z "$cursor" ]]; then break; fi; page=$((page + 1)); done`. Every status is 200. Some page's `items` contains an object whose `id` and `slug` equal the create response.
- **Duplicate slug.** Run `curl -sS -o "$RUN_DIR/drive/conflict.json" -w '%{http_code}' -X POST "$BASE_URL/v1/payers" -H "authorization: Bearer $ANUMAT_VERIFY_KEY" -H 'content-type: application/json' -d '{"name":"Verify Payer","slug":"'"$SLUG"'","market":"us"}' > "$RUN_DIR/drive/conflict.status"`. HTTP 409. `error.code` is `conflict` and `error.message` is `A payer with slug $SLUG already exists`.
- **Invalid body.** Run `curl -sS -o "$RUN_DIR/drive/invalid.json" -w '%{http_code}' -X POST "$BASE_URL/v1/payers" -H "authorization: Bearer $ANUMAT_VERIFY_KEY" -H 'content-type: application/json' -d '{"name":"Aetna","slug":"Aetna Inc","market":"in"}' > "$RUN_DIR/drive/invalid.status"`. HTTP 400. `error.code` is `validation_failed` and `error.details.issues` includes path `slug` and path `market`.
- **Missing key.** Run `curl -sS -o "$RUN_DIR/drive/unauth.json" -w '%{http_code}' "$BASE_URL/v1/payers" > "$RUN_DIR/drive/unauth.status"`. HTTP 401. `error.code` is `unauthorized`.
- **Proof.** Build `.cursor/skills/verify-anumat/evidence/register-payer.json` with the Evidence script in `SKILL.md`. The file includes the create body and the list item with the same `id`.

## Gotchas

- The slug must match lowercase letters, digits, and single hyphens. `Aetna Inc` and market `in` are a 400, not a saved payer.
- Slugs are unique. There is no delete route. A second run needs the new `$SLUG` from launch, not a slug already stored.
- `GET /v1/payers` is ordered by slug, 20 per page unless `limit` is set. Read every page before calling the payer missing.
- Seeded slugs `cigna` and `uhc` may appear beside the verification payer. Match on `$SLUG`, not on the length of `items`.
- The header must be `Bearer` followed by a space and `$ANUMAT_VERIFY_KEY`. The key name `verify` is not the secret.
- The list is the persistence check. A 201 alone does not prove the payer was stored.
- Do not put the bearer key in the evidence file.

# anumat-py

Python client for the Anumat HTTP API. It calls REST at `{base_url}/api/v1`.

```bash
pip install anumat-py
```

```python
from anumat_py import AnumatClient

client = AnumatClient("http://127.0.0.1:4471", "your-api-key")
page = client.list_payers()
```

`base_url` is the server origin, without `/api/v1`. It must be an `http` or `https` URL. `api_key` must contain a non-blank value. `AnumatClient` raises `AnumatError` with code `validation_failed` when either value is wrong. The client sends `Authorization: Bearer <api_key>`.

Each method has a sync form and an `_async` form. An HTTP error raises `AnumatError` with `status` and `code` from the response. When the server sends `details` (for example a `not_a_policy` character count and outline sections), they are on `AnumatError.details`.

- `create_payer`, `list_payers`
- `create_source`, `list_sources`, `get_source`, `check_source`
- `get_policy`, `list_policy_versions`, `get_policy_version`
- `list_versions`, `get_version`, `approve_version`, `reject_version`
- `get_diff`

```python
payer = client.create_payer(name="Example Health", slug="example-health", market="us")
page = client.list_payers(limit=20)
```

`client.generated` is the client produced from `apps/api/openapi.json`. Regenerate it with `pnpm turbo generate --filter=anumat-py` after the API build.

The server is a separate process and requires `DATABASE_URL`. This client does not embed `anumat-engine`. See the repository [README](../../README.md) for how to run it.

`anumat-py` is Apache-2.0. The wheel includes `LICENSE`, `NOTICE`, and `py.typed`. The copyright line is `Copyright 2026 AmitMirgal`.

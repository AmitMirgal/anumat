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

`list_payers` is synchronous. `list_payers_async` is the same call on an async client. `base_url` is the server origin, without `/api/v1`. The client sends `Authorization: Bearer <api_key>`.

`client.generated` is the client produced from `apps/api/openapi.json`. Regenerate it with `pnpm turbo generate --filter=anumat-py` after the API build.

The server is a separate process. See the repository [README](../../README.md) for how to run it. This package is Apache-2.0 and is not published by the restructure that added it.

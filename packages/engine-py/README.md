# anumat-engine

`anumat-engine` runs the Anumat engine in a local process. The wheel ships the engine binary.

## Install

```bash
pip install anumat-engine
```

Each wheel contains the binary for one platform.

## Apply the migrations

`anumat-engine migrate` applies the SQL migrations bundled in the binary. It records them in `_prisma_migrations`. A second run leaves an up-to-date database unchanged.

```bash
anumat-engine migrate --db postgres://USER:PASSWORD@HOST:5432/DATABASE
```

## Call create_engine

```python
from anumat_engine import create_engine

with create_engine(database_url="postgres://USER:PASSWORD@HOST:5432/DATABASE") as engine:
    page = engine.list_payers()
```

`create_engine` starts the engine and returns after the engine health check succeeds. `engine.close()` stops the process. A `with` block calls `close()`. The process also stops when the parent process exits.

`storage` and `llm` are optional. `create_engine` does not read them from the environment.

For local files, pass `storage={"kind": "local", "data_dir": "data/policies"}`. The default directory is `./data/policies`. For object storage, pass `storage` with `kind` set to `s3` and `region`, `bucket`, `access_key_id`, and `secret_access_key`.

Pass `llm={"strong": "anthropic/claude-sonnet-4-5", "cheap": "anthropic/claude-haiku-4-5"}` when a check should call a model. Omit `llm` until a check needs one.

Engine methods use snake_case names for the functions exported by `@anumat/engine`. `engine.list_payers()` calls `listPayers`.

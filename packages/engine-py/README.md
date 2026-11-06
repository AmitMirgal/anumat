# anumat-engine

`anumat-engine` runs the Anumat engine in a local process. The wheel ships the engine binary. With a Postgres URL it stores a versioned catalog. Without a database it still extracts structured coverage rules from a policy PDF. It does not check individual patients.

## Install

```bash
pip install anumat-engine
```

Each wheel contains the binary for one platform.

## Extract without a database

```python
from pathlib import Path
from anumat_engine import create_engine

with create_engine(
    llm={"strong": "anthropic/claude-sonnet-4-5", "cheap": "anthropic/claude-haiku-4-5"},
) as engine:
    result = engine.extract(
        Path("bariatric-surgery.pdf").read_bytes(),
        payer="UnitedHealthcare",
        title="Bariatric Surgery",
    )
```

`result["extraction"]` is the structured US coverage object. Store it in your own database. Catalog, versioning, and approval methods raise `EngineError` with code `database_not_configured` until you pass `database_url`.

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

`database_url` is optional. `create_engine` starts the engine and returns after the engine health check succeeds. `engine.close()` stops the process. A `with` block calls `close()`. The process also stops when the parent process exits.

`storage` and `llm` are optional. `create_engine` does not read them from the environment.

For local files, pass `storage={"kind": "local", "data_dir": "data/policies"}`. The default directory is `./data/policies`. For object storage, pass one of:

```python
{"kind": "s3", "region": "...", "bucket": "...", "access_key_id": "...", "secret_access_key": "...", "endpoint": "..."}
{"kind": "gcs", "bucket": "...", "project_id": "...", "key_filename": "..."}
{"kind": "supabase", "url": "https://PROJECT.supabase.co", "api_key": "...", "bucket": "..."}
```

`endpoint` on S3 is the custom URL for an S3-compatible store. Prefer `kind` `gcs` or `supabase` when you want the native SDK.

Pass `llm={"strong": "anthropic/claude-sonnet-4-5", "cheap": "anthropic/claude-haiku-4-5"}` when extract or a check should call a model. Omit `llm` until a call needs one.

Engine methods use snake_case names for the functions exported by `@anumat/engine`. `engine.list_payers()` calls `listPayers`. `slugify` is the same slug function the JavaScript package exports.

```python
from anumat_engine import slugify

slugify("Example Health")
```

Pass one input object as keyword arguments. A bad URL, storage block, or model id raises `EngineError` with code `validation_failed` before the process starts. If the process exits during startup, the error message includes the process stderr.

The engine object has these methods besides `close`.

- `extract`
- `register_payer`, `get_payer`, `find_payer_by_slug`, `list_payers`
- `register_source`, `get_source`, `find_source_by_policy_key`, `list_sources`
- `check_source`, `due_sources`, `check_due_sources`
- `propose_version`, `approve_version`, `reject_version`
- `get_published_policy`, `get_published_version`, `list_published_versions`
- `get_version`, `list_versions`, `get_diff`, `diff_for_version`, `save_diff_notes`

Installing the source distribution on a platform without a wheel fails with the list of wheel tags. It does not leave a partial install that imports.

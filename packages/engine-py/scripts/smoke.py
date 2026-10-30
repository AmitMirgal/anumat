from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

from anumat_engine import EngineError, create_engine


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    migration = Path(os.environ["ANUMAT_MIGRATION_SQL"])
    expected = hashlib.sha256(migration.read_bytes()).hexdigest()
    _migrate(database_url)
    second = _migrate(database_url)
    if "No pending migrations to apply." not in second:
        raise SystemExit(f"second migrate did not report a current database:\n{second}")
    _expect_checksum(database_url, expected)
    slug = f"smoke-{uuid4().hex[:8]}"
    with tempfile.TemporaryDirectory(prefix="anumat-engine-") as data_dir:
        engine = create_engine(
            database_url=database_url,
            storage={"kind": "local", "data_dir": data_dir},
        )
        try:
            empty = engine.list_payers()
            if not isinstance(empty["items"], list) or empty["nextCursor"] is not None:
                raise SystemExit(f"expected a payer page, got {empty}")
            payer = engine.register_payer(name="Smoke Payer", slug=slug, market="us")
            if payer["slug"] != slug:
                raise SystemExit(f"register_payer returned {payer}")
            found = engine.find_payer_by_slug(slug=slug)
            if found is None or found["id"] != payer["id"]:
                raise SystemExit(f"find_payer_by_slug returned {found}")
            if engine.config["storage"]["kind"] != "local":
                raise SystemExit(f"storage config was {engine.config['storage']}")
            if engine.config["storage"]["dataDir"] != data_dir:
                raise SystemExit(f"data dir was {engine.config['storage']}")
        finally:
            engine.close()
        try:
            engine.list_payers()
        except EngineError as error:
            if error.code != "closed":
                raise
        else:
            raise SystemExit("list_payers succeeded after close")
        if engine._process.poll() is None:
            raise SystemExit("engine process was still running after close")
    print("smoke ok")
    print(f"migration checksum {expected}")


def _migrate(database_url: str) -> str:
    scripts = Path(sys.executable).parent
    command = "anumat-engine"
    for name in ("anumat-engine", "anumat-engine.exe"):
        candidate = scripts / name
        if candidate.is_file():
            command = str(candidate)
            break
    completed = subprocess.run(
        [command, "migrate", "--db", database_url],
        check=True,
        capture_output=True,
        text=True,
    )
    sys.stdout.write(completed.stdout)
    sys.stderr.write(completed.stderr)
    return completed.stdout


def _expect_checksum(database_url: str, expected: str) -> None:
    psql = shutil.which("psql")
    if psql is None:
        raise SystemExit("psql is required to check the migration checksum")
    recorded = subprocess.check_output(
        [
            psql,
            database_url,
            "-tAc",
            "SELECT checksum FROM _prisma_migrations WHERE migration_name = '20260929061425_init'",
        ],
        text=True,
    ).strip()
    if recorded != expected:
        raise SystemExit(f"checksum {recorded} != {expected}")


if __name__ == "__main__":
    main()

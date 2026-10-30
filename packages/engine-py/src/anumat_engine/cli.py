from __future__ import annotations

import os
import subprocess
import sys

from anumat_engine._binary import binary_path

USAGE = "Usage: anumat-engine migrate --db <url>"


class UsageError(Exception):
    pass


def main(argv: list[str] | None = None) -> None:
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        database_url = migrate_database_url(args)
    except UsageError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from None
    completed = subprocess.run(
        [str(binary_path()), "migrate", "--db", database_url],
        env={**os.environ, "ANUMAT_ENGINE_SIDECAR": "1"},
        check=False,
    )
    raise SystemExit(completed.returncode)


def migrate_database_url(args: list[str]) -> str:
    if args[:1] != ["migrate"]:
        raise UsageError(USAGE)
    database_url: str | None = None
    index = 1
    while index < len(args):
        arg = args[index]
        if arg == "--db":
            index += 1
            if index >= len(args):
                raise UsageError(USAGE)
            database_url = args[index]
        elif arg.startswith("--db="):
            database_url = arg.removeprefix("--db=")
        else:
            raise UsageError(USAGE)
        index += 1
    if not database_url:
        raise UsageError(USAGE)
    return database_url

from __future__ import annotations

import os
import re
import stat
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VERSION_SCRIPT = ROOT / "scripts" / "engine-py-release-version.sh"
RELEASE_SCRIPT = ROOT / "scripts" / "release-engine-py.sh"
PYTHON_VERSION = "0.1.2"
JS_VERSION = "0.1.1"


def _write_executable(path: Path, text: str) -> None:
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _repo_with_differing_versions(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    engine_py = repo / "packages" / "engine-py"
    engine_js = repo / "packages" / "engine"
    engine_py.mkdir(parents=True)
    engine_js.mkdir(parents=True)
    (engine_py / "pyproject.toml").write_text(
        f'[project]\nname = "anumat-engine"\nversion = "{PYTHON_VERSION}"\n'
    )
    (engine_js / "package.json").write_text(
        f'{{\n  "name": "@anumat/engine",\n  "version": "{JS_VERSION}"\n}}\n'
    )
    (repo / "uv.lock").write_text(
        f'[[package]]\nname = "anumat-engine"\nversion = "{PYTHON_VERSION}"\n'
    )
    return repo


def _stub_path(tmp_path: Path, *, pypi_present: str | None) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_executable(
        bin_dir / "uv",
        r"""#!/usr/bin/env bash
set -euo pipefail
directory=""
short=0
cmd=""
write_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    version) cmd="version"; shift ;;
    --short) short=1; shift ;;
    --directory) directory="$2"; shift 2 ;;
    --frozen) shift ;;
    *) write_args+=("$1"); shift ;;
  esac
done
if [[ "$cmd" != "version" || "$short" -ne 1 || -z "$directory" || ${#write_args[@]} -ne 0 ]]; then
  echo "unexpected uv invocation (write or missing --short/--directory)" >&2
  exit 2
fi
python3 - "$directory" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1], "pyproject.toml").read_text()
match = re.search(r'(?m)^version = "([^"]+)"', text)
if match is None:
    raise SystemExit(f"no version in {sys.argv[1]}/pyproject.toml")
print(match.group(1))
PY
""",
    )
    present = "" if pypi_present is None else pypi_present
    _write_executable(
        bin_dir / "curl",
        f"""#!/usr/bin/env bash
set -euo pipefail
url=""
for arg in "$@"; do
  case "$arg" in
    http*) url="$arg" ;;
  esac
done
printf '%s\\n' "$url" >> "${{CURL_LOG:?}}"
if [[ -n "{present}" && "$url" == "{present}" ]]; then
  exit 0
fi
exit 22
""",
    )
    _write_executable(
        bin_dir / "node",
        """#!/usr/bin/env bash
echo "node should not run during version selection" >&2
exit 99
""",
    )
    return bin_dir


def _run_version_script(
    repo: Path,
    bin_dir: Path,
    curl_log: Path,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["CURL_LOG"] = str(curl_log)
    env.pop("PYPI_TOKEN", None)
    return subprocess.run(
        ["bash", str(VERSION_SCRIPT)],
        cwd=repo,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def _snapshot(repo: Path) -> dict[str, str]:
    return {
        "pyproject": (repo / "packages" / "engine-py" / "pyproject.toml").read_text(),
        "package_json": (repo / "packages" / "engine" / "package.json").read_text(),
        "uv_lock": (repo / "uv.lock").read_text(),
    }


def test_differing_js_python_versions_selects_python_and_does_not_mutate(tmp_path: Path) -> None:
    repo = _repo_with_differing_versions(tmp_path)
    before = _snapshot(repo)
    curl_log = tmp_path / "curl.log"
    bin_dir = _stub_path(
        tmp_path,
        pypi_present=f"https://pypi.org/pypi/anumat-engine/{JS_VERSION}/json",
    )
    result = _run_version_script(repo, bin_dir, curl_log)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == PYTHON_VERSION
    assert JS_VERSION not in result.stdout
    urls = curl_log.read_text().splitlines()
    assert urls == [f"https://pypi.org/pypi/anumat-engine/{PYTHON_VERSION}/json"]
    assert _snapshot(repo) == before


def test_duplicate_pypi_version_is_rejected_without_mutation(tmp_path: Path) -> None:
    repo = _repo_with_differing_versions(tmp_path)
    before = _snapshot(repo)
    curl_log = tmp_path / "curl.log"
    bin_dir = _stub_path(
        tmp_path,
        pypi_present=f"https://pypi.org/pypi/anumat-engine/{PYTHON_VERSION}/json",
    )
    result = _run_version_script(repo, bin_dir, curl_log)
    assert result.returncode == 1
    assert result.stdout == ""
    assert f"anumat-engine {PYTHON_VERSION} is already on PyPI" in result.stderr
    assert "pnpm bump:engine:version" in result.stderr
    assert "Bump @anumat/engine first" not in result.stderr
    assert _snapshot(repo) == before


def test_release_script_uses_python_version_helper_and_does_not_copy_js() -> None:
    script = RELEASE_SCRIPT.read_text()
    helper = VERSION_SCRIPT.read_text()
    assert "bash scripts/engine-py-release-version.sh" in script
    assert "require('./packages/engine/package.json')" not in script
    assert "require('./packages/engine/package.json')" not in helper
    assert "Bump @anumat/engine first" not in script
    assert "Bump @anumat/engine first" not in helper
    assert not re.search(r'uv version "\$', script)
    assert "needle = 'name = \"anumat-engine\"\\nversion = \"'" not in script
    assert "git commit -m \"chore(anumat-engine): release" not in script
    assert 'tag="anumat-engine@$version"' in script
    assert "compile-sidecar.ts" in (ROOT / "packages" / "engine-py" / "scripts" / "build-wheel.sh").read_text()
    for line in script.splitlines():
        if "git push" in line:
            assert line.lstrip().startswith("echo ")
        if "uv publish" in line:
            assert "PYPI_TOKEN" in line

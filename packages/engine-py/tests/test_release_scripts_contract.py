from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = [
    ROOT / "scripts/release.sh",
    ROOT / "scripts/release-engine.sh",
    ROOT / "scripts/release-engine-py.sh",
    *sorted((ROOT / "scripts/release").glob("*.sh")),
]
# Bash 4+ tokens that fail on macOS /bin/bash 3.2. Character-class commas
# such as ${var//[[:space:]]/} are bash 3.2-safe and must not match.
BASH4_ONLY = (
    (re.compile(r"\bmapfile\b"), "mapfile"),
    (re.compile(r"\breadarray\b"), "readarray"),
    (re.compile(r"\bdeclare\s+-A\b"), "declare -A"),
    (re.compile(r"\b(?:declare|local)\s+-n\b"), "nameref"),
    (re.compile(r"\bcoproc\b"), "coproc"),
    (re.compile(r"\bglobstar\b"), "globstar"),
    (re.compile(r"\[\[\s+-v\b"), "[[ -v"),
    (re.compile(r"&>>"), "&>>"),
    (re.compile(r"\|&"), "|&"),
    (re.compile(r"\$\{[^}]+,,}"), "${var,,}"),
    (re.compile(r"\$\{[^}]+\^\^}"), "${var^^}"),
    (re.compile(r";;&"), ";;&"),
)


def test_package_release_scripts_never_push() -> None:
    for path in SCRIPTS:
        for line in path.read_text().splitlines():
            code = line.split("#", 1)[0]
            if "git push" in code:
                assert code.lstrip().startswith("echo "), f"{path}: {line}"


def test_four_commands_scope_tests_and_confirm_before_publish() -> None:
    engine = (ROOT / "scripts/release-engine.sh").read_text()
    engine_py = (ROOT / "scripts/release-engine-py.sh").read_text()
    sdks = (ROOT / "scripts/release.sh").read_text()
    finish_npm = (ROOT / "scripts/release/finish-npm.sh").read_text()
    finish_pypi = (ROOT / "scripts/release/finish-pypi.sh").read_text()

    assert "bash scripts/release/require-clean-main.sh" in engine
    assert "bash scripts/require-local-postgres.sh" in engine
    assert "pnpm turbo run build test --filter=@anumat/engine" in engine
    assert "check-pack.mjs" in engine
    assert "finish-npm.sh" in engine
    assert "pnpm turbo run build test\n" not in engine

    assert "bash scripts/release/require-clean-main.sh" in engine_py
    assert "bash scripts/require-local-postgres.sh" in engine_py
    assert engine_py.index("require-local-postgres.sh") < engine_py.index(
        "pnpm turbo run test --filter=anumat-engine"
    )
    assert "fetch-engine-ci-bundle.sh" in engine_py
    assert "ANUMAT_ENGINE_RELEASE_DIR" in engine_py
    assert "--bundle-dir" in engine_py
    assert "verify_engine_bundle.py" in engine_py
    assert "select_native_wheel.py" in engine_py
    assert "compile-sidecar.ts" not in engine_py
    assert "build-wheel.sh" not in engine_py

    assert "pnpm turbo run build --filter=@anumat/js" in sdks
    assert "pnpm --filter @anumat/js test" in sdks
    assert "pnpm turbo run build --filter=anumat-py" in sdks
    assert "pytest packages/sdk-python/tests" in sdks
    assert "ensure-smoke-database.mjs" in sdks
    assert "pnpm turbo run build test" not in sdks
    assert "make-smoke-venv.sh anumat-py-smoke" in sdks

    assert finish_npm.index("confirm-version.sh") < finish_npm.index("pnpm --filter")
    assert finish_pypi.index("confirm-version.sh") < finish_pypi.index("publish-pypi.sh")
    assert "npm whoami" in finish_npm
    whoami_at = finish_npm.index("npm whoami")
    confirm_publish = finish_npm.index("publish ${name}")
    assert whoami_at < confirm_publish
    assert finish_npm.index('status" == present') < finish_npm.index("compare-npm")


def test_engine_wheels_workflow_builds_sdist_and_bundle() -> None:
    workflow = (ROOT / ".github/workflows/engine-wheels.yml").read_text()
    assert "anumat-engine-sdist" in workflow
    assert "anumat-engine-release" in workflow
    assert "assemble_engine_bundle.py" in workflow
    assert "verify_engine_bundle.py" in workflow
    assert "workflow_dispatch" in workflow
    assert "expected 5 migration checksums" in workflow
    assert workflow.index("name: anumat-engine-${{ matrix.platform }}") < workflow.index(
        "Start Postgres"
    )
    assert "concurrency:" in workflow


def test_engine_wheels_convert_smoke_runs_on_every_wheel_job() -> None:
    workflow = (ROOT / ".github/workflows/engine-wheels.yml").read_text()
    assert "ci-convert-smoke.sh" in workflow
    assert workflow.index("ci-convert-smoke.sh") < workflow.index("Start Postgres")
    platforms = json.loads((ROOT / "packages/engine-py/platforms.json").read_text())
    arm = next(item for item in platforms if item["platform"] == "macosx_11_0_arm64")
    assert arm["runner"] == "macos-15"
    assert arm["target"] == "bun-darwin-arm64"
    assert arm["smoke"] is True
    win = next(item for item in platforms if item["platform"] == "win_amd64")
    assert win["runner"] == "windows-2022"
    assert win["smoke"] is False
    smokes = [item["platform"] for item in platforms if item["smoke"]]
    assert smokes == [
        "macosx_11_0_arm64",
        "macosx_11_0_x86_64",
        "manylinux_2_17_x86_64",
        "manylinux_2_17_aarch64",
    ]


def test_anydoc_native_targets_cover_wheel_bun_targets() -> None:
    source = (ROOT / "packages/engine-py/scripts/fetch-anydoc-native.mjs").read_text()
    hatch = (ROOT / "packages/engine-py/hatch_build.py").read_text()
    compile_sidecar = (ROOT / "packages/engine-py/scripts/compile-sidecar.ts").read_text()
    for target in (
        "bun-darwin-arm64",
        "bun-darwin-x64",
        "bun-linux-x64",
        "bun-linux-arm64",
        "bun-windows-x64",
    ):
        assert target in source
    assert "anydoc.node" in hatch
    assert "NAPI_RS_NATIVE_LIBRARY_PATH" in compile_sidecar
    assert "fetch-anydoc-native.mjs" in compile_sidecar
    assert "--force-local" in source
    assert "cwd: dir" in source
    assert "join(dir, tgz)" not in source
    convert = (ROOT / "packages/engine-py/scripts/ci-convert-smoke.sh").read_text()
    assert "docker" not in convert
    assert "convert_smoke.py" in convert


def test_ci_smoke_does_not_start_or_destroy_docker() -> None:
    ci = (ROOT / "packages/engine-py/scripts/ci-smoke.sh").read_text()
    assert "docker" not in ci
    assert "require-local-postgres.sh" in ci
    assert "ensure-smoke-database.mjs" in ci


def test_bash4_builtin_disable_is_effective(tmp_path: Path) -> None:
    prelude = tmp_path / "disable-bash4.sh"
    prelude.write_text("enable -n mapfile readarray 2>/dev/null || true\n")
    script = tmp_path / "uses-mapfile.sh"
    script.write_text("#!/usr/bin/env bash\nmapfile -t x < /dev/null\n")
    env = os.environ.copy()
    env["BASH_ENV"] = str(prelude)
    result = subprocess.run(
        ["bash", str(script)],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert "mapfile" in result.stderr


def test_fetch_engine_ci_bundle_retries_and_classifies_download_errors() -> None:
    fetch = (ROOT / "scripts/release/fetch-engine-ci-bundle.sh").read_text()
    engine_py = (ROOT / "scripts/release-engine-py.sh").read_text()
    assert "ANUMAT_ENGINE_DOWNLOAD_BACKOFF" in fetch
    assert "attempt ${attempt}/4" in fetch
    assert "Network error downloading" in fetch
    assert "ANUMAT_ENGINE_RELEASE_DIR" in fetch
    assert "--bundle-dir" in fetch
    assert "Check gh permissions (repo and workflow/artifact read)" not in fetch
    assert "compile-sidecar.ts" not in fetch
    assert "build-wheel.sh" not in fetch
    assert "owned_bundle" in engine_py
    assert engine_py.index("verify_engine_bundle.py") > engine_py.index("fetch-engine-ci-bundle.sh")


def test_scripts_are_bash_32_compatible() -> None:
    scripts = [
        *sorted((ROOT / "scripts").rglob("*.sh")),
        *sorted((ROOT / "packages/engine-py/scripts").glob("*.sh")),
    ]
    assert scripts, "expected shell scripts under scripts/"
    offenders: list[str] = []
    for path in scripts:
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            code = line.split("#", 1)[0]
            for pattern, name in BASH4_ONLY:
                if pattern.search(code):
                    offenders.append(f"{path.relative_to(ROOT)}:{lineno}: {name}: {line.strip()}")
            if re.search(r"(^|[^&]);&([^&]|$)", code):
                offenders.append(f"{path.relative_to(ROOT)}:{lineno}: ;&: {line.strip()}")
    assert not offenders, "bash 4-only syntax (macOS /bin/bash is 3.2):\n" + "\n".join(offenders)

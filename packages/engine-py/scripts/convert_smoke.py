from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from anumat_engine import create_engine
from anumat_engine._binary import binary_path, sidecar_env


def code_list_pdf() -> bytes:
    content = [
        "BT",
        "/F1 12 Tf",
        "72 740 Td (Prior Authorization Code List) Tj",
        "1 0 0 1 0 0 Tm",
        "72 718 Td (Policy Name) Tj",
        "1 0 0 1 0 0 Tm",
        "360 718 Td (CPT Code) Tj",
        "1 0 0 1 0 0 Tm",
        "72 700 Td (Bariatric Surgery) Tj",
        "1 0 0 1 0 0 Tm",
        "360 700 Td (43644) Tj",
        "ET",
    ]
    stream_body = "\n".join(content)
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream_body.encode())} >>\nstream\n{stream_body}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    pdf = "%PDF-1.4\n"
    offsets: list[int] = []
    for index, body in enumerate(objects):
        offsets.append(len(pdf.encode()))
        pdf += f"{index + 1} 0 obj\n{body}\nendobj\n"
    xref = len(pdf.encode())
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    pdf += "".join(f"{offset:010d} 00000 n \n" for offset in offsets)
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return pdf.encode()


def main() -> None:
    pdf = code_list_pdf()
    with create_engine():
        pass
    with tempfile.TemporaryDirectory(prefix="anumat-convert-smoke-") as tmp:
        path = Path(tmp) / "policy.pdf"
        path.write_bytes(pdf)
        completed = subprocess.run(
            [str(binary_path()), "convert", "--pdf", str(path)],
            check=False,
            capture_output=True,
            text=True,
            env=sidecar_env(),
        )
    sys.stdout.write(completed.stdout)
    sys.stderr.write(completed.stderr)
    if completed.returncode != 0:
        raise SystemExit(f"convert failed ({completed.returncode})")
    payload = json.loads(completed.stdout)
    if payload.get("converter") != "anydoc":
        raise SystemExit(f"expected converter anydoc, got {payload!r}")
    markdown = payload.get("markdown")
    if not isinstance(markdown, str) or "43644" not in markdown:
        raise SystemExit(f"convert markdown did not keep CPT 43644: {payload!r}")
    print("convert smoke ok")


if __name__ == "__main__":
    main()

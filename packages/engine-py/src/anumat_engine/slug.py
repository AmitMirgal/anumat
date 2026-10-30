from __future__ import annotations

import re
import unicodedata


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).lower()
    dashed = re.sub(r"[^a-z0-9]+", "-", normalized)
    return re.sub(r"^-+|-+$", "", dashed)

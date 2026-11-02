from __future__ import annotations

import re
import unicodedata


_SLUG_CHARS = {
    "ß": "ss",
    "ẞ": "ss",
    "Æ": "ae",
    "æ": "ae",
    "Ø": "o",
    "ø": "o",
    "Å": "a",
    "å": "a",
}


def slugify(value: str) -> str:
    mapped = "".join(_SLUG_CHARS.get(char, char) for char in value)
    normalized = unicodedata.normalize("NFKD", mapped)
    stripped = "".join(char for char in normalized if not unicodedata.category(char).startswith("M"))
    dashed = re.sub(r"[^a-z0-9]+", "-", stripped.lower())
    return re.sub(r"^-+|-+$", "", dashed)

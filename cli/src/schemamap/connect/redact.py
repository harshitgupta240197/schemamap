"""Removing secrets from text before it can be shown or logged."""

from __future__ import annotations

import re
from collections.abc import Iterable

MASK = "***"
_KEYWORD_SECRET = re.compile(r"(?i)\b(?:pwd|password)\s*=\s*(?:\{(?:[^}]|\}\})*\}|[^;\s]*)")


def redact(text: str, secrets: Iterable[str]) -> str:
    """Mask known secrets, longest first, then any ``PWD=...``/``Password=...`` fragment.

    Known secrets go first so a password that itself contains ``PWD=`` is masked whole instead
    of being cut in two by the keyword sweep.
    """
    for secret in sorted({s for s in secrets if s}, key=len, reverse=True):
        text = text.replace(secret, MASK)
    return _KEYWORD_SECRET.sub(MASK, text)

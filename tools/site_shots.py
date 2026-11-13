# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow==12.0.0"]
# ///
"""Optimise the landing-page screenshots into site/assets/.

Run `cd viewer && npm run site:shots` first; it writes raw PNGs to viewer/.site-shots/.
Each is reduced to a 256-colour palette (UI screenshots lose nothing visible) and saved with
maximum compression. Output is deterministic for the same input.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "viewer" / ".site-shots"
OUT = ROOT / "site" / "assets"
NAMES = {"map.png": "map.png", "detail.png": "detail.png"}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for source, target in NAMES.items():
        raw = RAW / source
        if not raw.exists():
            raise SystemExit(f"missing {raw}: run `npm run site:shots` in viewer/ first")
        with Image.open(raw) as image:
            small = image.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT)
            small.save(OUT / target, optimize=True)
        print(f"{target}: {raw.stat().st_size // 1024} KB -> {(OUT / target).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

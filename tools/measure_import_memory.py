#!/usr/bin/env python3
"""Measure the peak memory (RSS) of importing a snapshot into the launcher's library (#14).

    uv run --project cli tools/measure_import_memory.py --file path/to/snapshot.json[.gz]
    uv run --project cli tools/measure_import_memory.py --synthetic-mb 128 [--gzip]

The import is what ``POST /api/maps/import`` does after the upload is on disk: ``read_upload``
(unpack, parse, validate) and ``MapLibrary.add`` (embed in the viewer page, write the map
folder). Each measurement runs in a fresh child process, so one peak never hides another. The
peak is the process's own: ``ru_maxrss`` on macOS and Linux, ``PeakWorkingSetSize`` on Windows.

``--synthetic-mb N`` builds a valid snapshot of about N MB unpacked by copying the
AdventureWorks test fixture under renamed schemas; nothing comes from a real company. Output is
one line of JSON per measurement, ready for docs/PERFORMANCE.md.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import subprocess
import sys
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FIXTURE = REPO / "cli" / "tests" / "fixtures" / "adventureworks2022.snapshot.json"
_LISTS = ("schemas", "tables", "views", "routines", "relationships", "dependencies")
_MB = 1024 * 1024


def peak_rss_bytes() -> int:
    """The peak resident memory of this process so far."""
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = Counters()
        counters.cb = ctypes.sizeof(Counters)
        handle = ctypes.windll.kernel32.GetCurrentProcess()  # type: ignore[attr-defined]
        ctypes.windll.psapi.GetProcessMemoryInfo(  # type: ignore[attr-defined]
            handle, ctypes.byref(counters), counters.cb
        )
        return int(counters.PeakWorkingSetSize)
    import resource

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak if sys.platform == "darwin" else peak * 1024  # bytes on macOS, KB on Linux


def synthetic_snapshot(megabytes: int) -> bytes:
    """A valid snapshot of about ``megabytes`` MB: the fixture copied under renamed schemas."""
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    names = [item["name"] for item in document["schemas"]]
    pattern = re.compile(r"\b(" + "|".join(re.escape(name) for name in names) + r")\b")
    one = {key: document[key] for key in _LISTS}
    base = json.dumps(one, ensure_ascii=False)
    copies = max(1, round(megabytes * _MB / len(base.encode("utf-8"))))
    for key in _LISTS:
        document[key] = []
    for copy in range(copies):
        text = pattern.sub(lambda found, n=copy: f"{found.group(1)}_{n}", base)
        for key, items in json.loads(text).items():
            document[key].extend(items)
    return json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def measure(path: Path) -> dict[str, object]:
    """Import ``path`` in this process and report the peaks. Run in a child process."""
    from schemamap.ui.library import MapLibrary, read_upload
    from schemamap.errors import SchemaMapError
    from schemamap.viewer import PLACEHOLDER, ViewerTemplate, load_viewer

    before = peak_rss_bytes()
    started = time.perf_counter()
    snapshot = read_upload(path)
    after_read = peak_rss_bytes()
    with tempfile.TemporaryDirectory() as folder:
        try:
            template = load_viewer()  # the packaged page, when `tools/build_viewer.py` has run
        except SchemaMapError:
            template = ViewerTemplate(html=f"<html><body>{PLACEHOLDER}</body></html>", version="0")
        library = MapLibrary(Path(folder), template=lambda: template)
        library.add(snapshot)
    seconds = time.perf_counter() - started
    return {
        "file_mb": round(path.stat().st_size / _MB, 1),
        "tables": len(snapshot.tables),
        "baseline_rss_mb": round(before / _MB),
        "after_read_upload_rss_mb": round(after_read / _MB),
        "peak_rss_mb": round(peak_rss_bytes() / _MB),
        "seconds": round(seconds, 1),
        "viewer_page_mb": round(len(template.html) / _MB, 1),
    }


def run_child(path: Path) -> dict[str, object]:
    """Measure ``path`` in a fresh interpreter. A refusal is reported, not raised."""
    done = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--child", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = done.stdout.strip().splitlines()
    if done.returncode != 0 or not lines:
        return {"file_mb": round(path.stat().st_size / _MB, 1), "failed": done.stderr[-300:]}
    result: dict[str, object] = json.loads(lines[-1])
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0] if __doc__ else None)
    parser.add_argument("--file", type=Path, action="append", default=[], help="a snapshot file")
    parser.add_argument("--synthetic-mb", type=int, action="append", default=[], metavar="N")
    parser.add_argument("--gzip", action="store_true", help="store synthetic files gzipped")
    parser.add_argument("--child", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.child is not None:
        print(json.dumps(measure(args.child)))
        return 0
    if not args.file and not args.synthetic_mb:
        parser.error("give --file or --synthetic-mb")
    for path in args.file:
        print(json.dumps({"input": str(path)} | run_child(path)))
    with tempfile.TemporaryDirectory(prefix="schemamap-memory-") as folder:
        for megabytes in args.synthetic_mb:
            data = synthetic_snapshot(megabytes)
            target = Path(folder) / f"synthetic-{megabytes}.json"
            if args.gzip:
                target = target.with_suffix(".json.gz")
                target.write_bytes(gzip.compress(data, compresslevel=1))
            else:
                target.write_bytes(data)
            label = {"input": f"synthetic {megabytes} MB", "unpacked_mb": round(len(data) / _MB)}
            print(json.dumps(label | run_child(target)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

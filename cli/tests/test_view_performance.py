"""A 2,000-table snapshot embeds quickly. The sizes printed here are recorded in PERFORMANCE.md."""

from __future__ import annotations

import time

from snapshot_builders import synthetic_snapshot

from schemamap.viewer import PLACEHOLDER, embed_snapshot

TABLES = 2000
SEED = 2000
LIMIT_SECONDS = 2.0


def test_two_thousand_tables_embed_in_under_two_seconds() -> None:
    snapshot = synthetic_snapshot(TABLES, SEED)
    template = f"<html><body>{PLACEHOLDER}</body></html>"
    started = time.perf_counter()
    page = embed_snapshot(template, snapshot)
    elapsed = time.perf_counter() - started
    data_bytes = len(page.encode("utf-8")) - len(template.encode("utf-8")) + len(PLACEHOLDER)
    print(
        f"PERF view-embed tables={len(snapshot.tables)} relationships={len(snapshot.relationships)}"
        f" views={len(snapshot.views)} seconds={elapsed:.3f} data_bytes={data_bytes}"
    )
    assert len(snapshot.tables) == TABLES
    assert elapsed < LIMIT_SECONDS

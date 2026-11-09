"""The relationships section: declared foreign keys."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from schemamap.connect import MetadataExecutor
from schemamap.extract.rows import ForeignKeyRow
from schemamap.queries import QueryName
from schemamap.snapshot.ids import column_id, edge_id, foreign_key_id, object_id
from schemamap.snapshot.models import ReferentialAction, Relationship

_ACTIONS = {
    0: ReferentialAction.NO_ACTION,
    1: ReferentialAction.CASCADE,
    2: ReferentialAction.SET_NULL,
    3: ReferentialAction.SET_DEFAULT,
}


def build_relationships(rows: Iterable[ForeignKeyRow]) -> tuple[Relationship, ...]:
    """Group foreign key column-pair rows into relationships, sorted by ID.

    Columns are paired in key order. The edge ID comes from the ordered column IDs, so two
    foreign keys on the same columns share an edge but keep their own ``foreign_key`` IDs.
    """
    by_key: dict[tuple[str, str], list[ForeignKeyRow]] = defaultdict(list)
    for row in rows:
        by_key[(row.fk_schema_name, row.fk_name)].append(row)
    built = []
    for (fk_schema, fk_name), pairs in by_key.items():
        pairs.sort(key=lambda r: r.ordinal)
        first = pairs[0]
        from_columns = tuple(
            column_id(p.from_schema_name, p.from_table_name, p.from_column_name) for p in pairs
        )
        to_columns = tuple(
            column_id(p.to_schema_name, p.to_table_name, p.to_column_name) for p in pairs
        )
        built.append(
            Relationship(
                id=foreign_key_id(fk_schema, fk_name),
                name=fk_name,
                edge=edge_id(from_columns, to_columns),
                from_object=object_id(first.from_schema_name, first.from_table_name),
                from_columns=from_columns,
                to_object=object_id(first.to_schema_name, first.to_table_name),
                to_columns=to_columns,
                on_delete=_ACTIONS.get(first.on_delete, ReferentialAction.NO_ACTION),
                on_update=_ACTIONS.get(first.on_update, ReferentialAction.NO_ACTION),
                disabled=bool(first.is_disabled),
                trusted=not first.is_not_trusted,
            )
        )
    return tuple(sorted(built, key=lambda r: r.id))


def extract_relationships(executor: MetadataExecutor) -> tuple[Relationship, ...]:
    """Read every declared foreign key between user tables."""
    return build_relationships(ForeignKeyRow(*row) for row in executor.run(QueryName.FOREIGN_KEYS))

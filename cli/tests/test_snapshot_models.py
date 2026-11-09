"""Snapshot v1 models: round-trip, determinism, integrity, compatibility and safety rules."""

from __future__ import annotations

import enum
import json
import random
import types
import typing
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from pydantic import AwareDatetime, BaseModel, ValidationError

from schemamap.errors import SnapshotError, SnapshotVersionError
from schemamap.snapshot import dump_snapshot, load_snapshot, redact_server
from schemamap.snapshot.ids import (
    column_id,
    constraint_id,
    edge_id,
    foreign_key_id,
    index_id,
    object_id,
    schema_id,
)
from schemamap.snapshot.models import Snapshot

CAPTURED = "2026-11-08T12:00:00Z"
HOSTILE_TABLE = "</script>"
HOSTILE_COLUMN = "a.b]"


def col(table: str, name: str, ordinal: int, **extra: Any) -> dict[str, Any]:
    return {
        "id": column_id("dbo", table, name),
        "name": name,
        "ordinal": ordinal,
        "data_type": "int",
        "nullable": False,
        **extra,
    }


def snapshot_doc() -> dict[str, Any]:
    """A small but complete snapshot with hostile names, as a JSON-shaped document."""
    customers, orders = object_id("dbo", "Customers"), object_id("dbo", HOSTILE_TABLE)
    cust_id = column_id("dbo", "Customers", "Id")
    order_fk = column_id("dbo", HOSTILE_TABLE, HOSTILE_COLUMN)
    pk_index = index_id("dbo", "Customers", "PK_Customers")
    return {
        "format": "schemamap.snapshot",
        "format_version": "1.0",
        "generator": {"name": "schemamap", "version": "0.0.1"},
        "captured_at": CAPTURED,
        "source": {"server": "lab-host", "database": "Sample", "compatibility_level": 160},
        "schemas": [{"id": schema_id("dbo"), "name": "dbo"}],
        "tables": [
            {
                "id": orders,
                "schema_id": schema_id("dbo"),
                "name": HOSTILE_TABLE,
                "columns": [
                    col(HOSTILE_TABLE, "x'; DROP", 1, description="free text"),
                    col(
                        HOSTILE_TABLE,
                        HOSTILE_COLUMN,
                        2,
                        default={
                            "id": constraint_id("dbo", "DF_x"),
                            "name": "DF_x",
                            "definition": "((0))",
                        },
                    ),
                ],
            },
            {
                "id": customers,
                "schema_id": schema_id("dbo"),
                "name": "Customers",
                "columns": [col("Customers", "Id", 1, identity=True)],
                "indexes": [
                    {
                        "id": pk_index,
                        "name": "PK_Customers",
                        "kind": "clustered",
                        "unique": True,
                        "key_columns": [{"column": cust_id}],
                    }
                ],
                "key_constraints": [
                    {
                        "id": constraint_id("dbo", "PK_Customers"),
                        "name": "PK_Customers",
                        "kind": "primary_key",
                        "columns": [cust_id],
                        "index": pk_index,
                    }
                ],
                "check_constraints": [
                    {
                        "id": constraint_id("dbo", "CK_Id"),
                        "name": "CK_Id",
                        "definition": "([Id]>(0))",
                        "column": cust_id,
                    }
                ],
            },
        ],
        "views": [
            {
                "id": object_id("dbo", "vCustomers"),
                "schema_id": schema_id("dbo"),
                "name": "vCustomers",
                "columns": [col("vCustomers", "Id", 1)],
                "definition": "CREATE VIEW dbo.vCustomers AS SELECT Id FROM dbo.Customers",
                "definition_status": "available",
            }
        ],
        "routines": [
            {
                "id": object_id("dbo", "usp_Load"),
                "schema_id": schema_id("dbo"),
                "name": "usp_Load",
                "kind": "procedure",
                "definition_status": "encrypted",
            }
        ],
        "synonyms": [
            {
                "id": object_id("dbo", "RemoteOrders"),
                "schema_id": schema_id("dbo"),
                "name": "RemoteOrders",
                "target": {
                    "scope": "cross_server",
                    "name": {
                        "server": "LINKED1",
                        "database": "Sales",
                        "schema_name": "dbo",
                        "name": "Orders",
                    },
                },
            }
        ],
        "relationships": [
            {
                "id": foreign_key_id("dbo", "FK_Orders_Customers"),
                "name": "FK_Orders_Customers",
                "edge": edge_id([order_fk], [cust_id]),
                "from_object": orders,
                "from_columns": [order_fk],
                "to_object": customers,
                "to_columns": [cust_id],
                "on_delete": "cascade",
            }
        ],
        "dependencies": [
            {
                "from_object": object_id("dbo", "vCustomers"),
                "target": {
                    "scope": "local",
                    "name": {"schema_name": "dbo", "name": "Customers"},
                    "resolved": customers,
                },
            },
            {
                "from_object": object_id("dbo", "usp_Load"),
                "target": {
                    "scope": "cross_database",
                    "name": {"database": "Archive", "schema_name": "dbo", "name": "Old"},
                },
            },
            {
                "from_object": object_id("dbo", "usp_Load"),
                "target": {
                    "scope": "cross_server",
                    "name": {"server": "LINKED1", "database": "Sales", "name": "Orders"},
                },
            },
            {
                "from_object": object_id("dbo", "usp_Load"),
                "target": {
                    "scope": "cross_server",
                    "name": {"server": "LINKED2", "database": "Sales", "name": "Orders"},
                },
            },
        ],
        "warnings": [
            {"section": "query_history", "code": "permission_missing", "message": "skipped"}
        ],
        "row_counts": {"items": [{"object": customers, "rows": 42, "reserved_bytes": 65536}]},
        "query_history": None,
        "join_evidence": {
            "entries": [
                {
                    "from_column": order_fk,
                    "to_column": cust_id,
                    "source": "code",
                    "count": 3,
                }
            ]
            if order_fk < cust_id
            else [{"from_column": cust_id, "to_column": order_fk, "source": "code", "count": 3}],
            "parse_failure_count": 1,
        },
    }


def shuffled(doc: dict[str, Any], seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    out: dict[str, Any] = json.loads(json.dumps(doc))
    for key in ("schemas", "tables", "views", "routines", "synonyms", "dependencies"):
        rng.shuffle(out[key])
    for table in out["tables"]:
        rng.shuffle(table["columns"])
    return out


def test_round_trip_is_lossless_and_byte_stable() -> None:
    snap = Snapshot.model_validate(snapshot_doc())
    text = dump_snapshot(snap)
    again = load_snapshot(text)
    assert again == snap
    assert dump_snapshot(again) == text
    assert text.endswith("}\n")
    assert HOSTILE_TABLE in text  # names are stored verbatim; HTML escaping happens at export


@pytest.mark.parametrize("seed", range(5))
def test_input_order_does_not_change_output(seed: int) -> None:
    expected = dump_snapshot(Snapshot.model_validate(snapshot_doc()))
    assert dump_snapshot(Snapshot.model_validate(shuffled(snapshot_doc(), seed))) == expected


def test_lists_are_sorted() -> None:
    snap = Snapshot.model_validate(shuffled(snapshot_doc(), 1))
    assert [t.id for t in snap.tables] == sorted(t.id for t in snap.tables)
    assert [c.ordinal for c in snap.tables[0].columns] == [1, 2]


def test_optional_sections_are_null_when_not_collected() -> None:
    doc = snapshot_doc()
    for key in ("row_counts", "query_history", "join_evidence"):
        doc.pop(key)
    dumped = json.loads(dump_snapshot(Snapshot.model_validate(doc)))
    assert dumped["row_counts"] is None
    assert dumped["query_history"] is None
    assert dumped["join_evidence"] is None


def test_query_store_defaults_to_unknown_never_off() -> None:
    doc = snapshot_doc()
    doc["source"].pop("query_store", None)
    snap = Snapshot.model_validate(doc)
    assert snap.source.query_store.value == "unknown"
    for state in ("on", "off", "unknown"):
        doc["source"]["query_store"] = state
        assert Snapshot.model_validate(doc).source.query_store.value == state
    doc["source"]["query_store"] = "enabled"
    with pytest.raises(ValidationError):
        Snapshot.model_validate(doc)


def test_row_count_size_is_optional_and_never_negative() -> None:
    doc = snapshot_doc()
    item = doc["row_counts"]["items"][0]
    item.pop("reserved_bytes")
    assert Snapshot.model_validate(doc).row_counts.items[0].reserved_bytes is None  # type: ignore[union-attr]
    item["reserved_bytes"] = -1
    with pytest.raises(ValidationError):
        Snapshot.model_validate(doc)


def test_query_history_section_holds_counts_only() -> None:
    doc = snapshot_doc()
    doc["query_history"] = {
        "window_start": "2026-11-01T00:00:00Z",
        "window_end": CAPTURED,
        "items": [{"object": object_id("dbo", "usp_Load"), "execution_count": 7}],
    }
    snap = Snapshot.model_validate(doc)
    assert snap.query_history is not None
    assert snap.query_history.items[0].execution_count == 7


def mutate(path: list[str | int], value: Any) -> dict[str, Any]:
    doc = snapshot_doc()
    target: Any = doc
    for step in path[:-1]:
        target = target[step]
    target[path[-1]] = value
    return doc


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (["tables", 1, "columns", 0, "id"], column_id("dbo", "Other", "Id")),
        (["tables", 1, "key_constraints", 0, "index"], index_id("dbo", "Customers", "Nope")),
        (
            ["relationships", 0, "edge"],
            edge_id([column_id("dbo", "A", "x")], [column_id("dbo", "B", "y")]),
        ),
        (["relationships", 0, "to_object"], object_id("dbo", "Nope")),
        (["dependencies", 0, "target", "resolved"], object_id("dbo", "Missing")),
        (["dependencies", 1, "target", "resolved"], object_id("dbo", "Customers")),
        (["row_counts", "items", 0, "object"], object_id("dbo", "Ghost")),
        (["tables", 0, "schema_id"], schema_id("sales")),
        (["tables", 0, "id"], "dbo.Orders"),
        (["views", 0, "definition_status"], "encrypted"),
        (["routines", 0, "definition"], "CREATE PROC"),
        (["source", "server_redacted"], True),
        (["captured_at"], "2026-11-08T12:00:00+01:00"),
        (["format_version"], "1.01"),
        (["warnings", 0, "code"], "Not A Code"),
        (["schemas", 0, "id"], schema_id("other")),
    ],
)
def test_invalid_snapshots_are_rejected(path: list[str | int], value: Any) -> None:
    with pytest.raises(ValidationError):
        Snapshot.model_validate(mutate(path, value))


def test_duplicates_are_rejected() -> None:
    doc = snapshot_doc()
    doc["routines"].append(dict(doc["routines"][0]))
    with pytest.raises(ValidationError, match="duplicate"):
        Snapshot.model_validate(doc)


def test_two_foreign_keys_with_identical_columns_share_one_edge() -> None:
    doc = snapshot_doc()
    original = doc["relationships"][0]
    duplicate = {
        **original,
        "id": foreign_key_id("dbo", "FK_Orders_Customers_Again"),
        "name": "FK_Orders_Customers_Again",
    }
    doc["relationships"].append(duplicate)
    snap = Snapshot.model_validate(doc)
    assert len(snap.relationships) == 2
    assert {r.edge for r in snap.relationships} == {original["edge"]}
    assert len({r.id for r in snap.relationships}) == 2


def test_object_ids_are_unique_across_kinds() -> None:
    doc = snapshot_doc()
    doc["routines"][0]["id"] = object_id("dbo", "vCustomers")
    with pytest.raises(ValidationError, match="unique"):
        Snapshot.model_validate(doc)


def test_join_evidence_pairs_must_be_canonical() -> None:
    doc = snapshot_doc()
    entry = doc["join_evidence"]["entries"][0]
    entry["from_column"], entry["to_column"] = entry["to_column"], entry["from_column"]
    with pytest.raises(ValidationError, match="from_column < to_column"):
        Snapshot.model_validate(doc)


def test_v1_reader_accepts_v1_1_without_mistaking_guesses_for_keys() -> None:
    doc = snapshot_doc()
    doc["format_version"] = "1.1"
    doc["inferred_relationships"] = [
        {"edge": doc["relationships"][0]["edge"], "score": 0.9, "evidence": []}
    ]
    doc["relationships"][0]["future_field"] = True
    snap = load_snapshot(json.dumps(doc))
    assert len(snap.relationships) == 1
    assert "inferred_relationships" not in dump_snapshot(snap)


def test_unsupported_versions_and_formats_are_typed_errors() -> None:
    doc = snapshot_doc()
    doc["format_version"] = "2.0"
    with pytest.raises(SnapshotVersionError):
        load_snapshot(json.dumps(doc))
    with pytest.raises(SnapshotError):
        load_snapshot('{"format": "something-else"}')
    with pytest.raises(SnapshotError):
        load_snapshot("not json")
    with pytest.raises(SnapshotError):
        load_snapshot(json.dumps({**snapshot_doc(), "tables": "nope"}))


def test_redact_server_drops_host_and_linked_server_names() -> None:
    snap = redact_server(Snapshot.model_validate(snapshot_doc()))
    text = dump_snapshot(snap)
    assert snap.source.server is None
    assert snap.source.server_redacted
    for secret in ("lab-host", "LINKED1", "LINKED2"):
        assert secret not in text
    cross_server = [d for d in snap.dependencies if d.target.scope.value == "cross_server"]
    assert len(cross_server) == 1  # the two linked-server references collapse into one
    assert snap.synonyms[0].target.name.database == "Sales"


def test_captured_at_is_utc() -> None:
    snap = Snapshot.model_validate(snapshot_doc())
    assert snap.captured_at == datetime(2026, 11, 8, 12, tzinfo=timezone.utc)
    assert snap.captured_at.utcoffset() == timedelta(0)


# --- Structural safety rules -------------------------------------------------------------

ALLOWED_LEAVES: set[object] = {str, int, bool, datetime, AwareDatetime, type(None)}
CREDENTIAL_WORDS = ("password", "pwd", "secret", "token", "credential", "connection", "login")


def _models(root: type[BaseModel]) -> list[type[BaseModel]]:
    seen: list[type[BaseModel]] = []
    pending = [root]
    while pending:
        model = pending.pop()
        if model in seen:
            continue
        seen.append(model)
        for field in model.model_fields.values():
            pending.extend(_nested_models(field.annotation))
    return seen


def _nested_models(annotation: object) -> list[type[BaseModel]]:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return [annotation]
    return [m for arg in typing.get_args(annotation) for m in _nested_models(arg)]


def _check_type(annotation: object, where: str) -> None:
    origin = typing.get_origin(annotation)
    if origin is typing.Annotated:
        _check_type(typing.get_args(annotation)[0], where)
    elif origin is typing.Literal:
        assert all(isinstance(a, str) for a in typing.get_args(annotation)), where
    elif origin in (typing.Union, types.UnionType):
        for arg in typing.get_args(annotation):
            _check_type(arg, where)
    elif origin is tuple:
        args = typing.get_args(annotation)
        assert len(args) == 2 and args[1] is Ellipsis, f"{where}: only tuple[X, ...] allowed"
        _check_type(args[0], where)
    elif isinstance(annotation, type) and issubclass(annotation, BaseModel | enum.Enum):
        return
    else:
        assert annotation in ALLOWED_LEAVES, f"{where}: {annotation!r} is not an allowed type"


def test_every_field_is_concretely_typed() -> None:
    """No Any, dict, list of anything or bytes: there is nowhere to put row data."""
    for model in _models(Snapshot):
        for name, field in model.model_fields.items():
            _check_type(field.annotation, f"{model.__name__}.{name}")


def test_no_field_can_hold_credentials() -> None:
    for model in _models(Snapshot):
        for name in model.model_fields:
            assert not any(word in name.lower() for word in CREDENTIAL_WORDS), name

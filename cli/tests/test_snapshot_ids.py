"""ID escaping, canonical form and round-trip, including hostile names."""

from __future__ import annotations

import unicodedata
from collections.abc import Callable

import pytest
from hypothesis import assume, given
from hypothesis import strategies as st

from schemamap.errors import InvalidIdError
from schemamap.snapshot.ids import (
    EdgeId,
    IdKind,
    NameId,
    column_id,
    constraint_id,
    edge_id,
    escape_part,
    foreign_key_id,
    index_id,
    object_id,
    parent_object_id,
    parse_id,
    schema_id,
    unescape_part,
)

HOSTILE = [
    "a.b]",
    "x'; DROP TABLE t;--",
    "</script>",
    "%2E",
    "%",
    "[dbo]",
    "a b",
    "Order(s)",
    "a,b>c",
    "edge:dbo.x",
    "🦀",
    "שלום",
    "注文",
    "é",
    "é",
    "\u202eevil",
    "\x00",
    "line\nbreak",
    "\x85",
    "\u2028",
    '"quoted"',
]

# Names drawn from structural characters as well as arbitrary Unicode.
names = st.text(min_size=1) | st.text(
    alphabet=st.sampled_from(list("%.(),>:[]'\"<>/&\\ ab\x00\n")), min_size=1
)
names = names | st.sampled_from(HOSTILE)

BUILDERS: dict[IdKind, tuple[Callable[..., str], int]] = {
    IdKind.SCHEMA: (schema_id, 1),
    IdKind.OBJECT: (object_id, 2),
    IdKind.COLUMN: (column_id, 3),
    IdKind.INDEX: (index_id, 3),
    IdKind.CONSTRAINT: (constraint_id, 2),
    IdKind.FOREIGN_KEY: (foreign_key_id, 2),
}

name_ids = st.sampled_from(sorted(BUILDERS, key=lambda k: k.value)).flatmap(
    lambda kind: st.tuples(
        st.just(kind), st.lists(names, min_size=BUILDERS[kind][1], max_size=BUILDERS[kind][1])
    )
)


@st.composite
def edges(draw: st.DrawFn) -> tuple[list[str], list[str]]:
    width = draw(st.integers(min_value=1, max_value=4))
    sides = []
    for _ in range(2):
        schema, obj = draw(names), draw(names)
        cols = draw(st.lists(names, min_size=width, max_size=width))
        sides.append([column_id(schema, obj, c) for c in cols])
    return sides[0], sides[1]


def build(kind: IdKind, parts: list[str]) -> str:
    builder, _ = BUILDERS[kind]
    return builder(*parts)


@given(names)
def test_escape_round_trips_and_hides_delimiters(name: str) -> None:
    escaped = escape_part(name)
    assert unescape_part(escaped) == name
    assert not set(escaped) & set(".(),>")
    assert not any(unicodedata.category(ch) == "Cc" for ch in escaped)


@given(name_ids)
def test_name_ids_round_trip(kind_parts: tuple[IdKind, list[str]]) -> None:
    kind, parts = kind_parts
    text = build(kind, parts)
    assert parse_id(text) == NameId(kind, tuple(parts))
    assert parse_id(text, kind).to_id() == text


@given(name_ids, name_ids)
def test_name_ids_are_injective(a: tuple[IdKind, list[str]], b: tuple[IdKind, list[str]]) -> None:
    assume(a != b)
    assert build(*a) != build(*b)


@given(edges())
def test_edge_ids_round_trip(sides: tuple[list[str], list[str]]) -> None:
    from_cols, to_cols = sides
    text = edge_id(from_cols, to_cols)
    assert parse_id(text, IdKind.EDGE) == EdgeId(tuple(from_cols), tuple(to_cols))


@given(edges(), edges())
def test_edge_ids_are_injective(
    a: tuple[list[str], list[str]], b: tuple[list[str], list[str]]
) -> None:
    assume(a != b)
    assert edge_id(*a) != edge_id(*b)


@given(st.text())
def test_any_text_either_rejected_or_canonical(text: str) -> None:
    """Every ID that parses re-renders to exactly itself: one ID per name, no aliases."""
    try:
        parsed = parse_id(text)
    except InvalidIdError:
        return
    assert parsed.to_id() == text


@given(st.text(alphabet=st.sampled_from(list("%.(),>:2EFabe0schemaobjectcolumnedge")), max_size=40))
def test_structural_text_either_rejected_or_canonical(text: str) -> None:
    try:
        parsed = parse_id(text)
    except InvalidIdError:
        return
    assert parsed.to_id() == text


@pytest.mark.parametrize("name", HOSTILE)
def test_hostile_names_round_trip_in_every_kind(name: str) -> None:
    for kind, (_, count) in BUILDERS.items():
        parts = [name] * count
        assert parse_id(build(kind, parts)) == NameId(kind, tuple(parts))
    col = column_id("dbo", name, name)
    assert parse_id(edge_id([col], [col])) == EdgeId((col,), (col,))


def test_readable_examples() -> None:
    assert object_id("dbo", "Orders") == "object:dbo.Orders"
    assert column_id("dbo", "a.b]", "Id") == "column:dbo.a%2Eb].Id"
    assert object_id("dbo", "</script>") == "object:dbo.</script%3E"
    assert object_id("dbo", "%2E") == "object:dbo.%252E"
    assert schema_id("注文") == "schema:注文"
    cols = [column_id("dbo", "Orders", "CustomerId"), column_id("dbo", "Orders", "TenantId")]
    to = [column_id("dbo", "Customers", "Id"), column_id("dbo", "Customers", "TenantId")]
    assert edge_id(cols, to) == "edge:dbo.Orders(CustomerId,TenantId)>dbo.Customers(Id,TenantId)"


def test_unicode_is_not_normalized() -> None:
    assert object_id("dbo", "é") != object_id("dbo", "é")


@pytest.mark.parametrize(
    "text",
    [
        "",
        "dbo.Orders",
        "table:dbo.Orders",
        "object:dbo",
        "object:dbo.a.b",
        "object:dbo.",
        "object:.x",
        "object:dbo.a%2eb",
        "object:dbo.%41",
        "object:dbo.a%2",
        "object:dbo.a%ZZ",
        "object:dbo.%FF",
        "object:dbo.a\nb",
        "schema:a(b",
        "edge:dbo.A(x)",
        "edge:dbo.A(x)>dbo.B(y,z)",
        "edge:dbo.A()>dbo.B()",
        "edge:dbo.A(x)>dbo.B(y)>dbo.C(z)",
        "edge:A(x)>dbo.B(y)",
    ],
)
def test_malformed_or_non_canonical_ids_are_rejected(text: str) -> None:
    with pytest.raises(InvalidIdError):
        parse_id(text)


def test_kind_is_enforced() -> None:
    with pytest.raises(InvalidIdError):
        parse_id(object_id("dbo", "x"), IdKind.COLUMN)


def test_builders_reject_bad_input() -> None:
    with pytest.raises(InvalidIdError):
        object_id("dbo", "")
    with pytest.raises(InvalidIdError):
        escape_part("\ud800")
    a, b = column_id("dbo", "A", "x"), column_id("dbo", "B", "y")
    with pytest.raises(InvalidIdError):
        edge_id([a, b], [b, a])
    with pytest.raises(InvalidIdError):
        edge_id([a], [a, b])
    with pytest.raises(InvalidIdError):
        edge_id([], [])


def test_parent_object_id() -> None:
    assert parent_object_id(column_id("s.x", "t", "c")) == object_id("s.x", "t")
    assert parent_object_id(index_id("dbo", "t", "IX")) == object_id("dbo", "t")
    with pytest.raises(InvalidIdError):
        parent_object_id(object_id("dbo", "t"))

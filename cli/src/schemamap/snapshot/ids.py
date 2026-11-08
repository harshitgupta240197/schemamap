"""Stable, reversible IDs for everything in a snapshot.

An ID is ``<kind>:<body>``. Name-based bodies are escaped name parts joined by ``.``::

    schema:dbo
    object:dbo.Orders
    column:dbo.Orders.CustomerId
    index:dbo.Orders.IX_Orders_CustomerId
    constraint:dbo.PK_Orders
    foreign_key:dbo.FK_Orders_Customers

Relationship edges are derived from the ordered from-columns and to-columns, so the same
column mapping always has the same ID, whatever the constraint is called::

    edge:dbo.Orders(CustomerId,TenantId)>dbo.Customers(Id,TenantId)

Escaping percent-encodes (uppercase hex, UTF-8 bytes) only ``%``, the delimiters
``. ( ) , >`` and control characters; everything else, Unicode included, is kept verbatim and
never normalized. Parsing accepts only the canonical form, so each name has exactly one ID and
``parse_id(text).to_id() == text`` for every ID that parses.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum

from schemamap.errors import InvalidIdError

_DELIMITERS = frozenset("%.(),>")
_HEX = frozenset("0123456789ABCDEF")


class IdKind(str, Enum):
    """The kind prefix of an ID."""

    SCHEMA = "schema"
    OBJECT = "object"
    COLUMN = "column"
    INDEX = "index"
    CONSTRAINT = "constraint"
    FOREIGN_KEY = "foreign_key"
    EDGE = "edge"


_PART_COUNTS: dict[IdKind, int] = {
    IdKind.SCHEMA: 1,
    IdKind.OBJECT: 2,
    IdKind.COLUMN: 3,
    IdKind.INDEX: 3,
    IdKind.CONSTRAINT: 2,
    IdKind.FOREIGN_KEY: 2,
}

_SIDE = re.compile(r"([^.(),>]+)\.([^.(),>]+)\(([^.(),>]+(?:,[^.(),>]+)*)\)")


def _needs_escape(char: str) -> bool:
    return char in _DELIMITERS or unicodedata.category(char) == "Cc"


def escape_part(name: str) -> str:
    """Escape one name part (a schema, object, column, index or constraint name)."""
    if not name:
        raise InvalidIdError("names must not be empty")
    out: list[str] = []
    for char in name:
        if unicodedata.category(char) == "Cs":
            raise InvalidIdError("names must not contain unpaired surrogates")
        if _needs_escape(char):
            out.extend(f"%{byte:02X}" for byte in char.encode("utf-8"))
        else:
            out.append(char)
    return "".join(out)


def unescape_part(text: str) -> str:
    """Reverse :func:`escape_part`, accepting only its canonical output."""
    if not text:
        raise InvalidIdError("empty name part")
    raw = bytearray()
    i = 0
    while i < len(text):
        char = text[i]
        if char == "%":
            hex_digits = text[i + 1 : i + 3]
            if len(hex_digits) != 2 or not set(hex_digits) <= _HEX:
                raise InvalidIdError(f"bad escape sequence in {text!r}")
            raw.append(int(hex_digits, 16))
            i += 3
            continue
        try:
            raw += char.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise InvalidIdError(f"invalid character in {text!r}") from exc
        i += 1
    try:
        name = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InvalidIdError(f"escapes in {text!r} are not valid UTF-8") from exc
    if escape_part(name) != text:
        raise InvalidIdError(f"{text!r} is not in canonical form")
    return name


@dataclass(frozen=True)
class NameId:
    """A parsed name-based ID: its kind and unescaped name parts."""

    kind: IdKind
    parts: tuple[str, ...]

    def to_id(self) -> str:
        """Render this ID in canonical form."""
        return _name_id(self.kind, self.parts)


@dataclass(frozen=True)
class EdgeId:
    """A parsed edge ID: the ordered column IDs on each side."""

    from_columns: tuple[str, ...]
    to_columns: tuple[str, ...]

    def to_id(self) -> str:
        """Render this ID in canonical form."""
        return edge_id(self.from_columns, self.to_columns)


def _name_id(kind: IdKind, parts: Sequence[str]) -> str:
    expected = _PART_COUNTS[kind]
    if len(parts) != expected:
        raise InvalidIdError(f"{kind.value} IDs have {expected} part(s), got {len(parts)}")
    return f"{kind.value}:" + ".".join(escape_part(part) for part in parts)


def schema_id(schema: str) -> str:
    """ID of a schema."""
    return _name_id(IdKind.SCHEMA, (schema,))


def object_id(schema: str, name: str) -> str:
    """ID of a schema-scoped object: table, view, routine or synonym."""
    return _name_id(IdKind.OBJECT, (schema, name))


def column_id(schema: str, obj: str, column: str) -> str:
    """ID of a column of a table or view."""
    return _name_id(IdKind.COLUMN, (schema, obj, column))


def index_id(schema: str, table: str, index: str) -> str:
    """ID of an index. Index names are unique per table, so the table is part of the ID."""
    return _name_id(IdKind.INDEX, (schema, table, index))


def constraint_id(schema: str, name: str) -> str:
    """ID of a primary key, unique, check or default constraint (names are unique per schema)."""
    return _name_id(IdKind.CONSTRAINT, (schema, name))


def foreign_key_id(schema: str, name: str) -> str:
    """ID of a foreign key constraint (names are unique per schema)."""
    return _name_id(IdKind.FOREIGN_KEY, (schema, name))


def _side(columns: Sequence[str], label: str) -> str:
    if not columns:
        raise InvalidIdError(f"edge {label} side has no columns")
    parsed = [parse_id(column, IdKind.COLUMN) for column in columns]
    owners = {p.parts[:2] for p in parsed if isinstance(p, NameId)}
    if len(owners) != 1:
        raise InvalidIdError(f"edge {label} columns must all belong to one object")
    schema, obj = owners.pop()
    names = ",".join(escape_part(p.parts[2]) for p in parsed if isinstance(p, NameId))
    return f"{escape_part(schema)}.{escape_part(obj)}({names})"


def edge_id(from_columns: Sequence[str], to_columns: Sequence[str]) -> str:
    """ID of a relationship edge, from the ordered column IDs on each side."""
    if len(from_columns) != len(to_columns):
        raise InvalidIdError("edge sides must have the same number of columns")
    return f"{IdKind.EDGE.value}:{_side(from_columns, 'from')}>{_side(to_columns, 'to')}"


def _parse_side(text: str) -> tuple[str, ...]:
    match = _SIDE.fullmatch(text)
    if match is None:
        raise InvalidIdError(f"malformed edge side {text!r}")
    schema = unescape_part(match.group(1))
    obj = unescape_part(match.group(2))
    return tuple(column_id(schema, obj, unescape_part(name)) for name in match.group(3).split(","))


def parse_id(text: str, expected: IdKind | None = None) -> NameId | EdgeId:
    """Parse a canonical ID, optionally requiring a kind. Raises :class:`InvalidIdError`."""
    prefix, sep, body = text.partition(":")
    if not sep:
        raise InvalidIdError(f"{text!r} has no kind prefix")
    try:
        kind = IdKind(prefix)
    except ValueError as exc:
        raise InvalidIdError(f"unknown ID kind {prefix!r}") from exc
    if expected is not None and kind is not expected:
        raise InvalidIdError(f"expected a {expected.value} ID, got {text!r}")
    parsed: NameId | EdgeId
    if kind is IdKind.EDGE:
        sides = body.split(">")
        if len(sides) != 2:
            raise InvalidIdError(f"malformed edge ID {text!r}")
        from_cols, to_cols = _parse_side(sides[0]), _parse_side(sides[1])
        if len(from_cols) != len(to_cols):
            raise InvalidIdError("edge sides must have the same number of columns")
        parsed = EdgeId(from_cols, to_cols)
    else:
        parsed = NameId(kind, tuple(unescape_part(part) for part in body.split(".")))
    if parsed.to_id() != text:
        raise InvalidIdError(f"{text!r} is not in canonical form")
    return parsed


def parent_object_id(child_id: str) -> str:
    """Object ID that a column or index ID belongs to."""
    parsed = parse_id(child_id)
    if not isinstance(parsed, NameId) or parsed.kind not in (IdKind.COLUMN, IdKind.INDEX):
        raise InvalidIdError(f"{child_id!r} is not a column or index ID")
    return object_id(*parsed.parts[:2])

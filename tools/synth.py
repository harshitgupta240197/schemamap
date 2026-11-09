#!/usr/bin/env python3
"""Synthetic SQL Server schema generator with ground truth (Python standard library only).

    uv run tools/synth.py --tables 2000 --seed 1 --out lab-data/synth

Writes `<name>.sql` (a T-SQL build script) and `<name>.truth.json` (every true relationship,
declared or not, plus the traps that look like relationships but are not). The same seed always
gives byte-identical files. `uv run tools/lab.py synth` builds the script in the lab.

The generator aims at what real databases look like, not at any inference scoring rule: names
drift between conventions, many relationships are undeclared, some code joins on columns that
are not keys. See D-037 in docs/DECISIONS.md.

Only creates objects; the script touches one throwaway database whose name must start with
`SchemaMapSynth`. It never contains data statements.
"""

from __future__ import annotations

import argparse
import itertools
import json
import random
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

TRUTH_FORMAT = "schemamap-synth-truth/1"
DEFAULT_NAME = "SchemaMapSynth"
NAME_PREFIX = "SchemaMapSynth"
DEFAULT_TABLES = 2000
DEFAULT_SCHEMAS = 6
DEFAULT_SHARE = 0.3
MIN_TABLES = 10
BATCH_STATEMENTS = 25

SCHEMA_NAMES = (
    "dbo",
    "sales",
    "hr",
    "inventory",
    "finance",
    "dw",
    "staging",
    "web",
    "ref",
    "audit",
    "ops",
    "crm",
)

ENTITY_WORDS = (  # noqa: SIM905
    "Customer Order Product Invoice Supplier Employee Department Warehouse Shipment Payment "
    "Account Contract Ticket Project Task Campaign Lead Quote Asset Location Store Vendor "
    "Policy Claim Patient Visit Appointment Prescription Course Student Enrollment Instructor "
    "Booking Flight Route Vehicle Driver Trip Device Sensor Reading Event Session Document "
    "Review Subscription Plan Coupon Cart Refund Ledger Budget Forecast Tax Currency Address "
    "Contact Note Attachment Category Brand Material Batch Recipe Machine Inspection Incident "
    "Permit Survey Message Thread Shift Position Skill Certificate Benefit Expense Receipt "
    "Reservation Room Guest Menu Ingredient Delivery Package Pallet Carrier Tariff Territory "
    "Member Team Goal Milestone Release Build Defect Feature Release Server Backup Job Alert"
).split()

QUALIFIERS = (
    "",
    "Archive",
    "History",
    "Type",
    "Group",
    "Rule",
    "Source",
    "Setting",
    "Preference",
    "Template",
    "Schedule",
    "Rating",
    "Tag",
    "Log",
    "Region",
    "Level",
    "Version",
    "Request",
    "Summary",
    "Snapshot",
    "Queue",
    "Import",
    "Override",
    "Segment",
    "Cycle",
    "Window",
    "Quota",
    "Channel",
)

ORPHAN_WORDS = (  # noqa: SIM905
    "Tenant Workspace Cohort Franchise Affiliate Partner Origin Owner Reviewer Sponsor Broker "
    "Reseller Custodian Auditor Approver Requester Assignee"
).split()

# (PascalCase, snake_case, type) for plain data columns.
DATA_COLUMNS = (
    ("Name", "name", "nvarchar(100)"),
    ("Description", "description", "nvarchar(400)"),
    ("CreatedDate", "created_date", "datetime2"),
    ("ModifiedDate", "modified_date", "datetime2"),
    ("IsActive", "is_active", "bit"),
    ("Amount", "amount", "decimal(18,2)"),
    ("Quantity", "quantity", "int"),
    ("Notes", "notes", "nvarchar(max)"),
    ("Email", "email", "nvarchar(200)"),
    ("Phone", "phone", "varchar(30)"),
    ("Reference", "reference", "nvarchar(50)"),
    ("Priority", "priority", "tinyint"),
    ("StartDate", "start_date", "date"),
    ("EndDate", "end_date", "date"),
    ("Total", "total", "decimal(18,2)"),
    ("Title", "title", "nvarchar(200)"),
)
MEASURES = (
    ("Amount", "amount"),
    ("Quantity", "quantity"),
    ("Cost", "cost"),
    ("Discount", "discount"),
    ("Price", "price"),
)
PLAIN_CODES = (
    ("StatusCode", "status_code", "varchar(10)"),
    ("ZipCode", "zip_code", "varchar(10)"),
    ("CountryCode", "country_code", "char(2)"),
)

TABLE_STYLES = ("plural", "singular", "tbl", "snake", "snake_singular")
KEY_VARIANTS = ("ID", "Id", "snake", "AbbrId", "Key", "AbbrNo", "plainId")
KEY_WEIGHTS = (3, 2, 3, 1, 1, 1, 2)
PK_TYPES = ("int", "bigint", "uniqueidentifier", "varchar(20)")
PK_WEIGHTS = (70, 20, 5, 5)
SCALAR_PK_TYPES = frozenset(PK_TYPES)

_ESCAPED = frozenset("%.(),>")


class SynthError(ValueError):
    """Invalid generator arguments."""


def validate_database_name(name: str) -> str:
    """Return `name` if it is a safe lab-only synthetic database name, else raise."""
    if not re.fullmatch(r"[A-Za-z0-9_]{1,100}", name) or not name.startswith(NAME_PREFIX):
        raise SynthError(
            f"The database name must be letters, digits or _ and start with {NAME_PREFIX!r} "
            "so a sample database can never be replaced."
        )
    return name


def _esc(part: str) -> str:
    """Escape one name part exactly as schemamap.snapshot.ids.escape_part does."""
    return "".join("".join(f"%{b:02X}" for b in c.encode()) if c in _ESCAPED else c for c in part)


def column_id(schema: str, table: str, column: str) -> str:
    """Column ID in the snapshot format."""
    return f"column:{_esc(schema)}.{_esc(table)}.{_esc(column)}"


def object_id(schema: str, name: str) -> str:
    """Object ID in the snapshot format."""
    return f"object:{_esc(schema)}.{_esc(name)}"


def edge_id(
    schema: str,
    table: str,
    columns: Sequence[str],
    to_schema: str,
    to_table: str,
    to_columns: Sequence[str],
) -> str:
    """Relationship edge ID in the snapshot format."""
    left = f"{_esc(schema)}.{_esc(table)}({','.join(_esc(c) for c in columns)})"
    right = f"{_esc(to_schema)}.{_esc(to_table)}({','.join(_esc(c) for c in to_columns)})"
    return f"edge:{left}>{right}"


def snake(text: str) -> str:
    """CustomerArchive -> customer_archive."""
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text).lower()


def plural(text: str) -> str:
    """A simple English plural, good enough for table names."""
    if re.search(r"[^aeiou]y$", text):
        return text[:-1] + "ies"
    if re.search(r"(s|x|ch|sh)$", text):
        return text + "es"
    return text + "s"


@dataclass(frozen=True)
class Entity:
    """A business concept: the word, an optional qualifier, and the short form."""

    word: str
    qualifier: str

    @property
    def pascal(self) -> str:
        return self.word + self.qualifier

    @property
    def abbr(self) -> str:
        base = self.word[:4] if len(self.word) > 5 else self.word
        return base + self.qualifier[:3]


@dataclass(eq=False)
class Profile:
    """A schema's naming conventions."""

    name: str
    table_style: str
    key_variant: str

    @property
    def snake(self) -> bool:
        return self.key_variant == "snake" or self.table_style.startswith("snake")


@dataclass
class Column:
    name: str
    type: str
    nullable: bool = True
    identity: bool = False


@dataclass(eq=False)
class Table:
    schema: str
    name: str
    kind: str
    entity: Entity
    profile: Profile
    columns: list[Column] = field(default_factory=list)
    pk: list[str] = field(default_factory=list)
    pk_variant: str = ""

    def column(self, name: str) -> Column | None:
        lowered = name.lower()
        return next((c for c in self.columns if c.name.lower() == lowered), None)

    def type_of(self, name: str) -> str:
        column = self.column(name)
        assert column is not None
        return column.type


@dataclass(eq=False)
class Relationship:
    child: Table
    child_columns: list[str]
    parent: Table
    parent_columns: list[str]
    kind: str
    declared: bool = False

    @property
    def edge(self) -> str:
        return edge_id(
            self.child.schema,
            self.child.name,
            self.child_columns,
            self.parent.schema,
            self.parent.name,
            self.parent_columns,
        )


@dataclass(frozen=True)
class Synthetic:
    """A generated database: the build script and its ground truth."""

    script: str
    truth: dict[str, object]

    @property
    def relationship_count(self) -> int:
        """Number of true relationships in the ground truth."""
        relationships = self.truth["relationships"]
        assert isinstance(relationships, list)
        return len(relationships)

    def truth_json(self) -> str:
        """The ground truth as stable text."""
        return json.dumps(self.truth, indent=2, sort_keys=True, ensure_ascii=True) + "\n"


class _Generator:
    def __init__(self, seed: int, tables: int, schemas: int, share: float, database: str) -> None:
        self.rng = random.Random(seed)
        self.seed = seed
        self.total = tables
        self.share = share
        self.database = database
        names = SCHEMA_NAMES[:schemas]
        self.profiles = [self._profile(n) for n in names]
        self.dw = next((p for p in self.profiles if p.name == "dw"), self.profiles[-1])
        self.tables: list[Table] = []
        self.rels: list[Relationship] = []
        self.traps: list[dict[str, object]] = []
        self.code_joins: list[dict[str, object]] = []
        self.statements: list[list[str]] = []
        self._used_names: set[tuple[str, str]] = set()
        self._used_entities: set[tuple[str, str]] = set()
        self._used_dims: set[str] = set()
        self._fk_names: set[tuple[str, str]] = set()
        self._views: list[str] = []

    # ------------------------------------------------------------------ helpers

    def _profile(self, name: str) -> Profile:
        if name == "dw":
            return Profile(name, self.rng.choice(("singular", "snake_singular")), "Key")
        style = self.rng.choice(TABLE_STYLES)
        variant = self.rng.choices(KEY_VARIANTS, KEY_WEIGHTS)[0]
        return Profile(name, style, variant)

    def _entity(self) -> Entity:
        for _ in range(200):
            entity = Entity(self.rng.choice(ENTITY_WORDS), self.rng.choice(QUALIFIERS))
            if (entity.word, entity.qualifier) not in self._used_entities:
                self._used_entities.add((entity.word, entity.qualifier))
                return entity
        index = len(self._used_entities)
        entity = Entity(self.rng.choice(ENTITY_WORDS), f"V{index}")
        self._used_entities.add((entity.word, entity.qualifier))
        return entity

    def _table_name(self, profile: Profile, entity: Entity, prefix: str = "") -> str:
        pascal = entity.pascal
        style = profile.table_style
        if style == "plural":
            name = plural(pascal)
        elif style == "tbl":
            name = "tbl" + pascal
        elif style == "snake":
            name = snake(plural(pascal))
        elif style == "snake_singular":
            name = snake(pascal)
        else:
            name = pascal
        if prefix:
            name = f"{prefix}_{snake(pascal)}" if profile.snake else prefix + pascal
        return self._unique(profile.name, name)

    def _unique(self, schema: str, name: str) -> str:
        candidate, counter = name, 1
        while (schema.lower(), candidate.lower()) in self._used_names:
            counter += 1
            candidate = f"{name}{counter}"
        self._used_names.add((schema.lower(), candidate.lower()))
        return candidate

    def key_name(self, entity: Entity, variant: str, snake_case: bool = False) -> str:
        """The key column name for `entity` in a naming `variant`."""
        pascal = entity.pascal
        names = {
            "ID": f"{pascal}ID",
            "Id": f"{pascal}Id",
            "snake": f"{snake(pascal)}_id",
            "AbbrId": f"{entity.abbr}Id",
            "Key": f"{pascal}Key",
            "AbbrNo": f"{entity.abbr}_No",
            "plainId": "Id",
        }
        name = names[variant]
        if snake_case and variant in ("ID", "Id", "Key"):
            return snake(name)
        return name

    def _pick_variant(self, profile: Profile) -> str:
        if self.rng.random() < 0.12:
            return self.rng.choices(KEY_VARIANTS, KEY_WEIGHTS)[0]
        return profile.key_variant

    def _fk_name(self, child: Profile, parent: Table, taken: set[str]) -> str | None:
        if self.rng.random() < 0.6 and len(parent.pk) == 1 and parent.pk_variant != "plainId":
            name = parent.pk[0]
        else:
            variant = child.key_variant
            name = self.key_name(parent.entity, variant, child.snake)
            if name == "Id":
                name = self.key_name(parent.entity, "Id", child.snake)
        return None if name.lower() in taken else name

    def _data_columns(self, table: Table, low: int = 2, high: int = 7) -> None:
        taken = {c.name.lower() for c in table.columns}
        for pascal, snaked, kind in self.rng.sample(DATA_COLUMNS, self.rng.randint(low, high)):
            name = snaked if table.profile.snake else pascal
            if name.lower() not in taken:
                taken.add(name.lower())
                table.columns.append(Column(name, kind, self.rng.random() < 0.5))

    def _new_table(self, profile: Profile, entity: Entity, kind: str, name: str) -> Table:
        table = Table(profile.name, name, kind, entity, profile)
        self.tables.append(table)
        return table

    def _add_pk(self, table: Table, nullable_type: str | None = None) -> None:
        variant = self._pick_variant(table.profile)
        name = self.key_name(table.entity, variant, table.profile.snake)
        kind = nullable_type or self.rng.choices(PK_TYPES, PK_WEIGHTS)[0]
        identity = kind in ("int", "bigint") and self.rng.random() < 0.6
        table.columns.insert(0, Column(name, kind, False, identity))
        table.pk = [name]
        table.pk_variant = variant

    def _link(
        self, child: Table, parent: Table, kind: str, nullable: bool | None = None
    ) -> Relationship | None:
        taken = {c.name.lower() for c in child.columns}
        name = self._fk_name(child.profile, parent, taken)
        if name is None or len(parent.pk) != 1:
            return None
        flag = self.rng.random() < 0.4 if nullable is None else nullable
        child.columns.append(Column(name, parent.type_of(parent.pk[0]), flag))
        rel = Relationship(child, [name], parent, list(parent.pk), kind)
        self.rels.append(rel)
        return rel

    def _profile_for_core(self) -> Profile:
        pool = [p for p in self.profiles if p is not self.dw] or [self.dw]
        return self.rng.choices(pool, [3 if p.name == "dbo" else 1 for p in pool])[0]

    # ------------------------------------------------------------------ table families

    def _core(self, count: int) -> list[Table]:
        core: list[Table] = []
        for _ in range(count):
            profile = self._profile_for_core()
            entity = self._entity()
            table = self._new_table(profile, entity, "entity", self._table_name(profile, entity))
            self._add_pk(table)
            self._data_columns(table)
            if core:
                for parent in self._parents(core, profile):
                    self._link(table, parent, "hierarchy")
            if self.rng.random() < 0.06:
                self._self_reference(table)
            core.append(table)
        return core

    def _parents(self, core: list[Table], profile: Profile) -> list[Table]:
        wanted = self.rng.choice((0, 1, 1, 2, 2, 3))
        local = [t for t in core if t.schema == profile.name]
        chosen: list[Table] = []
        for _ in range(wanted):
            pool = local if local and self.rng.random() < 0.7 else core
            parent = pool[self.rng.randrange(len(pool))]
            if parent not in chosen:
                chosen.append(parent)
        return chosen

    def _self_reference(self, table: Table) -> None:
        name = "parent_id" if table.profile.snake else self.rng.choice(("ParentId", "ParentID"))
        if table.column(name) is not None or len(table.pk) != 1:
            return
        table.columns.append(Column(name, table.type_of(table.pk[0]), True))
        self.rels.append(Relationship(table, [name], table, list(table.pk), "self"))

    def _details(self, budget: int, core: list[Table]) -> None:
        while budget > 0:
            parent = core[self.rng.randrange(len(core))]
            suffix = self.rng.choice(("Line", "Item", "Detail"))
            entity = Entity(parent.entity.word, parent.entity.qualifier + suffix)
            profile = parent.profile
            detail = self._new_table(profile, entity, "detail", self._table_name(profile, entity))
            rel = self._link(detail, parent, "hierarchy", nullable=False)
            budget -= 1
            if rel is None:
                self._drop(detail)
                continue
            line_no = "line_no" if profile.snake else "LineNo"
            detail.columns.append(Column(line_no, "int", False))
            detail.pk = [rel.child_columns[0], line_no]
            self._data_columns(detail, 1, 4)
            if budget > 0 and self.rng.random() < 0.5:
                budget -= 1
                self._sub_detail(detail, line_no)

    def _sub_detail(self, detail: Table, line_no: str) -> None:
        entity = Entity(detail.entity.word, detail.entity.qualifier + "Note")
        sub = self._new_table(
            detail.profile, entity, "sub_detail", self._table_name(detail.profile, entity)
        )
        sub.columns.append(Column("note_id" if sub.profile.snake else "NoteId", "int", False, True))
        sub.pk = [sub.columns[0].name]
        columns = [detail.pk[0], line_no]
        for name in columns:
            sub.columns.append(Column(name, detail.type_of(name), False))
        self._data_columns(sub, 1, 3)
        self.rels.append(Relationship(sub, columns, detail, list(detail.pk), "composite"))

    def _drop(self, table: Table) -> None:
        self.tables.remove(table)
        self._used_names.discard((table.schema.lower(), table.name.lower()))

    def _bridges(self, budget: int, core: list[Table]) -> None:
        for _ in range(budget):
            first, second = self.rng.sample(core, 2)
            entity = Entity(first.entity.pascal, second.entity.pascal)
            profile = first.profile
            bridge = self._new_table(profile, entity, "bridge", self._table_name(profile, entity))
            links = [self._link(bridge, first, "bridge", False)]
            links.append(self._link(bridge, second, "bridge", False))
            bridge.pk = [c.name for c in bridge.columns]
            if any(link is None for link in links) or len(set(bridge.pk)) != 2:
                for link in links:
                    if link is not None:
                        self.rels.remove(link)
                self._drop(bridge)
                continue
            if self.rng.random() < 0.5:
                self._data_columns(bridge, 1, 2)

    def _islands(self, budget: int) -> None:
        profile = self.dw
        while budget > 0:
            dims: list[Table] = []
            count = min(budget - 1, self.rng.randint(3, 6)) if budget > 1 else 1
            for _ in range(count):
                dims.append(self._dimension(profile))
            budget -= count
            if budget > 0:
                self._fact(profile, dims)
                budget -= 1

    def _dimension(self, profile: Profile) -> Table:
        for _ in range(100):
            entity = self._entity()
            if entity.pascal not in self._used_dims:
                break
        self._used_dims.add(entity.pascal)
        name = self._table_name(profile, entity, prefix="dim")
        dim = self._new_table(profile, entity, "dimension", name)
        key = self.key_name(entity, "Key", profile.snake)
        dim.columns.append(Column(key, "int", False, True))
        dim.pk, dim.pk_variant = [key], "Key"
        self._data_columns(dim, 2, 5)
        return dim

    def _fact(self, profile: Profile, dims: list[Table]) -> None:
        entity = self._entity()
        fact = self._new_table(profile, entity, "fact", self._table_name(profile, entity, "fact"))
        for dim in dims:
            self._link(fact, dim, "star", nullable=False)
        taken = {c.name.lower() for c in fact.columns}
        for pascal, snaked in self.rng.sample(MEASURES, self.rng.randint(1, 3)):
            name = snaked if profile.snake else pascal
            if name.lower() not in taken:
                fact.columns.append(Column(name, "decimal(18,2)", False))
        fact.columns.append(
            Column("order_number" if profile.snake else "OrderNumber", "varchar(20)", True)
        )
        roll = self.rng.random()
        keys = [c.name for c in fact.columns if c.name in {r.child_columns[0] for r in self.rels}]
        if roll < 0.25 and keys:
            fact.pk = keys
        elif roll < 0.5:
            name = "fact_id" if profile.snake else "FactId"
            fact.columns.insert(0, Column(name, "bigint", False, True))
            fact.pk = [name]

    def _keyless(self, budget: int, core: list[Table]) -> None:
        for _ in range(budget):
            profile = self.rng.choice(self.profiles)
            entity = Entity(
                self.rng.choice(ENTITY_WORDS), self.rng.choice(("Load", "Import", "Raw", "Temp"))
            )
            name = self._table_name(profile, entity, prefix="stg")
            table = self._new_table(profile, entity, "keyless", name)
            for parent in self.rng.sample(core, min(len(core), self.rng.randint(0, 2))):
                self._link(table, parent, "keyless", nullable=True)
            self._data_columns(table, 3, 8)

    # ------------------------------------------------------------------ traps

    def _free_table(self, avoid: Table | None = None) -> Table:
        candidates = [t for t in self.tables if t.kind in ("entity", "keyless", "detail")]
        for _ in range(50):
            table = candidates[self.rng.randrange(len(candidates))]
            if table is avoid:
                continue
            related = any(
                {r.child, r.parent} == {table, avoid} for r in self.rels if avoid is not None
            )
            if not related:
                return table
        return candidates[0]

    def _add_column(self, table: Table, name: str, kind: str) -> str | None:
        if table.column(name) is not None:
            return None
        table.columns.append(Column(name, kind, True))
        return column_id(table.schema, table.name, name)

    def _traps(self) -> None:
        total = len(self.tables)
        for pascal, snaked, kind in PLAIN_CODES:
            ids = []
            for table in self.rng.sample(self.tables, min(total, max(3, total // 12))):
                if table.kind in ("dimension", "fact"):
                    continue
                name = snaked if table.profile.snake else pascal
                column = self._add_column(table, name, kind)
                if column:
                    ids.append(column)
            self.traps.append(
                {
                    "kind": "plain_code",
                    "columns": sorted(ids),
                    "reason": f"{pascal} looks like a key but is plain data; no table owns it",
                }
            )
        keyed = [
            t
            for t in self.tables
            if t.kind == "entity" and len(t.pk) == 1 and t.pk_variant != "plainId"
        ]
        for _ in range(max(1, total // 60)):
            self._name_trap(keyed, "same_name_different_meaning", None, "an external system's id")
        for _ in range(max(1, total // 80)):
            self._name_trap(keyed, "type_mismatch", "varchar(20)", "same name, incompatible type")
        pk_names = {pk.lower() for t in self.tables for pk in t.pk}
        for _ in range(max(2, total // 30)):
            word = self.rng.choice(ORPHAN_WORDS)
            table = self._free_table()
            name = f"{snake(word)}_id" if table.profile.snake else f"{word}Id"
            if name.lower() in pk_names:
                continue
            column = self._add_column(table, name, "int")
            if column:
                self.traps.append(
                    {"kind": "orphan_id", "columns": [column], "reason": "no table owns this id"}
                )

    def _name_trap(self, keyed: list[Table], kind: str, override: str | None, reason: str) -> None:
        if not keyed:
            return
        target = keyed[self.rng.randrange(len(keyed))]
        source = self._free_table(target)
        name = target.pk[0]
        column_type = override or target.type_of(name)
        column = self._add_column(source, name, column_type)
        if column:
            self.traps.append(
                {
                    "kind": kind,
                    "from_column": column,
                    "to_column": column_id(target.schema, target.name, name),
                    "reason": reason,
                }
            )

    # ------------------------------------------------------------------ declared FKs, code

    def _choose_declared(self) -> None:
        count = round(self.share * len(self.rels))
        order = list(range(len(self.rels)))
        self.rng.shuffle(order)
        for index in order[:count]:
            self.rels[index].declared = True

    def _alias_columns(self, items: list[tuple[str, Table]]) -> str:
        seen: set[str] = set()
        parts = []
        for alias, table in items:
            column = table.pk[0] if table.pk else table.columns[0].name
            name = column
            while name.lower() in seen:
                name += "_2"
            seen.add(name.lower())
            parts.append(f"{alias}.[{column}] AS [{name}]")
        return ", ".join(parts)

    def _join_sql(self, chain: list[Relationship]) -> tuple[str, list[tuple[str, Table]]]:
        aliases: dict[Table, str] = {}
        first = chain[0]
        aliases[first.child] = "a"
        lines = [f"FROM [{first.child.schema}].[{first.child.name}] AS a"]
        for rel in chain:
            new = next(t for t in (rel.child, rel.parent) if t not in aliases)
            aliases[new] = chr(ord("a") + len(aliases))
            lines.append(f"JOIN [{new.schema}].[{new.name}] AS {aliases[new]}")
            pairs = zip(rel.child_columns, rel.parent_columns, strict=True)
            on = " AND ".join(
                f"{aliases[rel.child]}.[{c}] = {aliases[rel.parent]}.[{p}]" for c, p in pairs
            )
            lines[-1] += f" ON {on}"
        return "\n".join(lines), [(alias, table) for table, alias in aliases.items()]

    def _chain(self) -> list[Relationship]:
        useful = [r for r in self.rels if r.child is not r.parent]
        first = useful[self.rng.randrange(len(useful))]
        chain = [first]
        for _ in range(self.rng.choice((0, 0, 1, 2))):
            nexts = [
                r
                for r in useful
                if r not in chain
                and ({r.child, r.parent} & {c for x in chain for c in (x.child, x.parent)})
                and not {r.child, r.parent} <= {c for x in chain for c in (x.child, x.parent)}
            ]
            if not nexts:
                break
            chain.append(nexts[self.rng.randrange(len(nexts))])
        return chain

    def _code_objects(self) -> list[str]:
        statements: list[str] = []
        if not self.rels:
            return statements
        non_key = self._non_key_pairs()
        views = max(1, self.total // 8)
        procs = max(1, self.total // 20)
        for index in range(views + procs):
            is_view = index < views
            if self.rng.random() < 0.2 and non_key:
                left, right, left_col, right_col = non_key[self.rng.randrange(len(non_key))]
                body = (
                    f"FROM [{left.schema}].[{left.name}] AS a\n"
                    f"JOIN [{right.schema}].[{right.name}] AS b ON a.[{left_col}] = b.[{right_col}]"
                )
                items = [("a", left), ("b", right)]
                joins = [(left, left_col, right, right_col, "non_key")]
            else:
                chain = self._chain()
                body, items = self._join_sql(chain)
                joins = [
                    (r.child, c, r.parent, p, "relationship")
                    for r in chain
                    for c, p in zip(r.child_columns, r.parent_columns, strict=True)
                ]
            home = items[0][1]
            names = "".join(t.entity.pascal for _, t in items[:2])
            if is_view:
                name = self._unique(home.schema, f"vw_{names}")
                select = self._alias_columns(items)
                sql = f"CREATE VIEW [{home.schema}].[{name}] AS\nSELECT {select}\n{body};"
            else:
                name = self._unique(home.schema, f"usp_Get{names}")
                key = items[0][1].pk[0] if items[0][1].pk else items[0][1].columns[0].name
                key_type = items[0][1].type_of(key)
                indented = body.replace("\n", "\n    ")
                sql = (
                    f"CREATE PROCEDURE [{home.schema}].[{name}] @key {key_type}\nAS\nBEGIN\n"
                    f"    SET NOCOUNT ON;\n    SELECT {self._alias_columns(items)}\n"
                    f"    {indented}\n    WHERE a.[{key}] = @key;\nEND;"
                )
            statements.append(sql)
            owner = object_id(home.schema, name)
            for child, c, parent, p, kind in joins:
                self.code_joins.append(
                    {
                        "object": owner,
                        "kind": kind,
                        "from_column": column_id(child.schema, child.name, c),
                        "to_column": column_id(parent.schema, parent.name, p),
                    }
                )
        return statements

    def _non_key_pairs(self) -> list[tuple[Table, Table, str, str]]:
        """Same-named plain columns in two tables: a join on them is not a relationship."""
        by_name: dict[str, list[Table]] = {}
        for table in self.tables:
            for column in table.columns:
                lowered = column.name.lower()
                if lowered in {"zipcode", "zip_code", "statuscode", "status_code"} or (
                    lowered in {"createddate", "created_date"}
                ):
                    by_name.setdefault(column.name, []).append(table)
        pairs: list[tuple[Table, Table, str, str]] = []
        for name in sorted(by_name):
            tables = by_name[name]
            pairs.extend((a, b, name, name) for a, b in itertools.pairwise(tables))
        return pairs

    # ------------------------------------------------------------------ output

    def _create_table(self, table: Table) -> str:
        lines = []
        for column in table.columns:
            identity = " IDENTITY(1,1)" if column.identity else ""
            null = " NULL" if column.nullable else " NOT NULL"
            lines.append(f"    [{column.name}] {column.type}{identity}{null}")
        if table.pk:
            columns = ", ".join(f"[{c}]" for c in table.pk)
            lines.append(f"    CONSTRAINT [PK_{table.name}] PRIMARY KEY CLUSTERED ({columns})")
        body = ",\n".join(lines)
        return f"CREATE TABLE [{table.schema}].[{table.name}] (\n{body}\n);"

    def _foreign_key(self, rel: Relationship) -> str:
        base = f"FK_{rel.child.name}_{rel.parent.name}"[:120]
        name, counter = base, 1
        while (rel.child.schema.lower(), name.lower()) in self._fk_names:
            counter += 1
            name = f"{base}_{counter}"
        self._fk_names.add((rel.child.schema.lower(), name.lower()))
        child = ", ".join(f"[{c}]" for c in rel.child_columns)
        parent = ", ".join(f"[{c}]" for c in rel.parent_columns)
        return (
            f"ALTER TABLE [{rel.child.schema}].[{rel.child.name}] ADD CONSTRAINT [{name}] "
            f"FOREIGN KEY ({child}) REFERENCES [{rel.parent.schema}].[{rel.parent.name}] "
            f"({parent});"
        )

    def _indexes(self) -> list[str]:
        statements = []
        for number, rel in enumerate(self.rels, 1):
            if rel.child_columns == rel.child.pk[: len(rel.child_columns)]:
                continue
            if self.rng.random() < 0.4:
                columns = ", ".join(f"[{c}]" for c in rel.child_columns)
                name = f"IX_{rel.child.name}_{number}"[:120]
                statements.append(
                    f"CREATE INDEX [{name}] ON [{rel.child.schema}].[{rel.child.name}] ({columns});"
                )
        return statements

    def build(self) -> Synthetic:
        total = self.total
        keyless = max(1, int(total * 0.04 + 0.5))
        bridges = int(total * 0.05 + 0.5)
        details = int(total * 0.05 + 0.5)
        islands = int(total * 0.18 + 0.5)
        core_count = total - keyless - bridges - details - islands
        core = self._core(core_count)
        self._details(details, core)
        self._bridges(bridges, core)
        self._islands(islands)
        self._keyless(keyless, core)
        while len(self.tables) < total:
            self._core(1)
        self._traps()
        self._choose_declared()
        return Synthetic(self._script(), self._truth())

    def _script(self) -> str:
        name = self.database
        out = [
            f"-- Schema Map synthetic database, seed {self.seed}, {len(self.tables)} tables.",
            "SET NOCOUNT ON;",
            "USE [master];",
            "GO",
            f"IF DB_ID(N'{name}') IS NOT NULL",
            "BEGIN",
            f"    ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;",
            f"    DROP DATABASE [{name}];",
            "END",
            "GO",
            f"CREATE DATABASE [{name}];",
            "GO",
            f"ALTER DATABASE [{name}] SET RECOVERY SIMPLE;",
            "GO",
            f"USE [{name}];",
            "GO",
        ]
        for profile in self.profiles:
            if profile.name != "dbo":
                out += [f"CREATE SCHEMA [{profile.name}];", "GO"]
        self._batched(out, [self._create_table(t) for t in self.tables])
        self._batched(out, [self._foreign_key(r) for r in self.rels if r.declared])
        self._batched(out, self._indexes())
        for statement in self._code_objects():
            out += [statement, "GO"]
        return "\n".join(out) + "\n"

    @staticmethod
    def _batched(out: list[str], statements: list[str]) -> None:
        for start in range(0, len(statements), BATCH_STATEMENTS):
            out += statements[start : start + BATCH_STATEMENTS]
            out.append("GO")

    def _truth(self) -> dict[str, object]:
        relationships = [
            {
                "edge": r.edge,
                "declared": r.declared,
                "kind": r.kind,
                "from_columns": [
                    column_id(r.child.schema, r.child.name, c) for c in r.child_columns
                ],
                "to_columns": [
                    column_id(r.parent.schema, r.parent.name, c) for c in r.parent_columns
                ],
            }
            for r in sorted(self.rels, key=lambda r: r.edge)
        ]
        traps = sorted(self.traps, key=lambda t: json.dumps(t, sort_keys=True))
        joins = sorted(self.code_joins, key=lambda j: json.dumps(j, sort_keys=True))
        return {
            "format": TRUTH_FORMAT,
            "generator": {
                "database": self.database,
                "seed": self.seed,
                "tables": len(self.tables),
                "schemas": [p.name for p in self.profiles],
                "declared_fk_share": self.share,
            },
            "relationships": relationships,
            "traps": traps,
            "code_joins": joins,
        }


def generate(
    seed: int = 1,
    tables: int = DEFAULT_TABLES,
    schemas: int = DEFAULT_SCHEMAS,
    declared_fk_share: float = DEFAULT_SHARE,
    name: str = DEFAULT_NAME,
) -> Synthetic:
    """Generate a database script and its ground truth; deterministic in all arguments."""
    if tables < MIN_TABLES:
        raise SynthError(f"--tables must be at least {MIN_TABLES}.")
    if not 1 <= schemas <= len(SCHEMA_NAMES):
        raise SynthError(f"--schemas must be between 1 and {len(SCHEMA_NAMES)}.")
    if not 0.0 <= declared_fk_share <= 1.0:
        raise SynthError("--declared-fk-share must be between 0 and 1.")
    return _Generator(
        seed, tables, schemas, declared_fk_share, validate_database_name(name)
    ).build()


def write_files(result: Synthetic, name: str, directory: Path) -> tuple[Path, Path]:
    """Write `<name>.sql` and `<name>.truth.json` into `directory`; return both paths."""
    directory.mkdir(parents=True, exist_ok=True)
    script = directory / f"{name}.sql"
    truth = directory / f"{name}.truth.json"
    script.write_text(result.script, encoding="utf-8", newline="\n")
    truth.write_text(result.truth_json(), encoding="utf-8", newline="\n")
    return script, truth


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """The generator's options, shared with `lab.py synth`."""
    parser.add_argument("--tables", type=int, default=DEFAULT_TABLES)
    parser.add_argument("--schemas", type=int, default=DEFAULT_SCHEMAS)
    parser.add_argument("--declared-fk-share", type=float, default=DEFAULT_SHARE)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--name", default=DEFAULT_NAME, help=f"database name, starts {NAME_PREFIX}")
    parser.add_argument("--out", type=Path, default=Path("lab-data/synth"))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Synthetic schema generator with ground truth.")
    add_arguments(parser)
    args = parser.parse_args(argv)
    try:
        result = generate(args.seed, args.tables, args.schemas, args.declared_fk_share, args.name)
    except SynthError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    script, truth = write_files(result, args.name, args.out)
    print(f"Wrote {script} and {truth} ({result.relationship_count} true relationships).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

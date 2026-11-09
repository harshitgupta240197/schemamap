"""Snapshot format v1: the metadata Schema Map extracts from one database.

Rules every model here follows (see docs/ARCHITECTURE.md):

* Metadata only. Every field has a concrete type; there is no ``Any`` and no open mapping, so
  nothing can carry row data. Free text is limited to names, descriptions and definitions.
* Deterministic. Unordered lists are sorted by ID on validation and duplicates are rejected;
  ordered lists (columns, key columns) keep catalog order.
* Forward compatible. Unknown fields are ignored on read, so a v1.0 reader accepts v1.x files.
* No credentials. Nothing here can hold a login, password, token or connection string.
"""

from __future__ import annotations

import itertools
from collections.abc import Callable, Iterable
from datetime import timedelta
from enum import Enum
from typing import Annotated, Final, Literal, Protocol, TypeVar

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from schemamap.snapshot.ids import IdKind, NameId, edge_id, parent_object_id, parse_id

FORMAT: Final = "schemamap.snapshot"
FORMAT_VERSION = "1.0"


def _id_of(kind: IdKind) -> AfterValidator:
    def check(value: str) -> str:
        parse_id(value, kind)
        return value

    return AfterValidator(check)


SchemaId = Annotated[str, _id_of(IdKind.SCHEMA)]
ObjectId = Annotated[str, _id_of(IdKind.OBJECT)]
ColumnId = Annotated[str, _id_of(IdKind.COLUMN)]
IndexId = Annotated[str, _id_of(IdKind.INDEX)]
ConstraintId = Annotated[str, _id_of(IdKind.CONSTRAINT)]
ForeignKeyId = Annotated[str, _id_of(IdKind.FOREIGN_KEY)]
EdgeIdStr = Annotated[str, _id_of(IdKind.EDGE)]
Name = Annotated[str, Field(min_length=1)]
Count = Annotated[int, Field(ge=0)]

M = TypeVar("M", bound=BaseModel)


class _Identified(Protocol):
    @property
    def id(self) -> str: ...


IdT = TypeVar("IdT", bound=_Identified)


T = TypeVar("T")


def _sorted_unique(items: Iterable[T], key: Callable[[T], str], what: str) -> tuple[T, ...]:
    ordered = tuple(sorted(items, key=key))
    for first, second in itertools.pairwise(ordered):
        if key(first) == key(second):
            raise ValueError(f"duplicate {what} {key(first)!r}")
    return ordered


def _by_id(item: _Identified) -> str:
    return item.id


def _by_content(item: BaseModel) -> str:
    return item.model_dump_json()


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, use_attribute_docstrings=True)


class DefinitionStatus(str, Enum):
    """Whether a module's SQL definition is in the snapshot, and if not, why."""

    AVAILABLE = "available"
    ENCRYPTED = "encrypted"
    NOT_PERMITTED = "not_permitted"
    NOT_APPLICABLE = "not_applicable"


class _HasDefinition(_Model):
    definition: str | None = None
    """SQL text of the module. Free text written by the database's developers: it may contain
    literals. Present only when definition_status is "available"."""
    definition_status: DefinitionStatus

    @model_validator(mode="after")
    def _definition_matches_status(self) -> _HasDefinition:
        available = self.definition_status is DefinitionStatus.AVAILABLE
        if available != (self.definition is not None):
            raise ValueError("definition must be present exactly when status is 'available'")
        return self


class Generator(_Model):
    """The tool that wrote the snapshot."""

    name: Literal["schemamap"] = "schemamap"
    version: Name


class QueryStoreState(str, Enum):
    """Whether Query Store is enabled. ``unknown`` means the login cannot read the setting."""

    ON = "on"
    OFF = "off"
    UNKNOWN = "unknown"


class SourceInfo(_Model):
    """Where the snapshot came from. Never holds a login, password or connection string."""

    server: Name | None = None
    """Server host or instance name; null when redacted (--redact-server) or unknown."""
    server_redacted: bool = False
    database: Name
    product_version: str | None = None
    engine_edition: str | None = None
    compatibility_level: int | None = None
    collation: str | None = None
    query_store: QueryStoreState = QueryStoreState.UNKNOWN
    """Never ``off`` unless the login was allowed to read the setting and it was off."""

    @model_validator(mode="after")
    def _redacted_means_no_server(self) -> SourceInfo:
        if self.server_redacted and self.server is not None:
            raise ValueError("a redacted source must not name its server")
        return self


class Schema(_Model):
    """A database schema."""

    id: SchemaId
    name: Name
    description: str | None = None


class ComputedColumn(_Model):
    """How a computed column is calculated."""

    definition: str
    """SQL expression. Free text that may contain literals."""
    persisted: bool


class DefaultConstraint(_Model):
    """A column's default constraint."""

    id: ConstraintId
    name: Name
    definition: str
    """SQL expression. Free text that may contain literals."""


class Column(_Model):
    """A column of a table or view."""

    id: ColumnId
    name: Name
    ordinal: Annotated[int, Field(ge=1)]
    """Position in the table (column_id order from the catalog)."""
    data_type: Name
    """System type name, for example "nvarchar"."""
    user_type: str | None = None
    """Qualified alias type name, for example "dbo.Phone", when the column uses one."""
    length: int | None = None
    """Declared length in characters (character types) or bytes (binary types)."""
    is_max: bool = False
    precision: int | None = None
    scale: int | None = None
    nullable: bool
    identity: bool = False
    computed: ComputedColumn | None = None
    default: DefaultConstraint | None = None
    collation: str | None = None
    description: str | None = None


def _sorted_columns(columns: tuple[Column, ...]) -> tuple[Column, ...]:
    _sorted_unique(columns, _by_id, "column")
    return _sorted_unique(columns, lambda c: f"{c.ordinal:06d}", "column ordinal")


class IndexKind(str, Enum):
    """Physical kind of an index."""

    CLUSTERED = "clustered"
    NONCLUSTERED = "nonclustered"
    CLUSTERED_COLUMNSTORE = "clustered_columnstore"
    NONCLUSTERED_COLUMNSTORE = "nonclustered_columnstore"
    XML = "xml"
    SPATIAL = "spatial"
    HASH = "hash"
    OTHER = "other"


class IndexColumn(_Model):
    """One key column of an index."""

    column: ColumnId
    descending: bool = False


class Index(_Model):
    """An index on a table. Heaps have no index entry."""

    id: IndexId
    name: Name
    kind: IndexKind
    unique: bool
    key_columns: tuple[IndexColumn, ...]
    """Key columns in key order."""
    included_columns: tuple[ColumnId, ...] = ()
    filter: str | None = None
    """Filter predicate of a filtered index. Free text that may contain literals."""
    disabled: bool = False


class KeyKind(str, Enum):
    """Kind of key constraint."""

    PRIMARY_KEY = "primary_key"
    UNIQUE = "unique"


class KeyConstraint(_Model):
    """A primary key or unique constraint."""

    id: ConstraintId
    name: Name
    kind: KeyKind
    columns: tuple[ColumnId, ...] = Field(min_length=1)
    """Key columns in key order."""
    index: IndexId
    """The index that enforces the constraint."""


class CheckConstraint(_Model):
    """A check constraint."""

    id: ConstraintId
    name: Name
    definition: str
    """SQL predicate. Free text that may contain literals."""
    column: ColumnId | None = None
    """Set for a column-level constraint."""
    disabled: bool = False
    trusted: bool = True


class TemporalType(str, Enum):
    """Whether a table takes part in system versioning."""

    NONE = "none"
    SYSTEM_VERSIONED = "system_versioned"
    """A current table whose history is kept in a history table."""
    HISTORY = "history"
    """The history table of a system-versioned table."""


class Table(_Model):
    """A user table."""

    id: ObjectId
    schema_id: SchemaId
    name: Name
    description: str | None = None
    temporal_type: TemporalType = TemporalType.NONE
    memory_optimized: bool = False
    columns: tuple[Column, ...]
    indexes: tuple[Index, ...] = ()
    key_constraints: tuple[KeyConstraint, ...] = ()
    check_constraints: tuple[CheckConstraint, ...] = ()

    @field_validator("columns")
    @classmethod
    def _sort_columns(cls, columns: tuple[Column, ...]) -> tuple[Column, ...]:
        return _sorted_columns(columns)

    @field_validator("indexes", "key_constraints", "check_constraints")
    @classmethod
    def _sort(cls, items: tuple[IdT, ...]) -> tuple[IdT, ...]:
        return _sorted_unique(items, _by_id, "table member")

    @model_validator(mode="after")
    def _members_belong(self) -> Table:
        own = {c.id for c in self.columns}
        indexes = {i.id for i in self.indexes}
        refs = [c.column for i in self.indexes for c in i.key_columns]
        refs += [c for i in self.indexes for c in i.included_columns]
        refs += [c for k in self.key_constraints for c in k.columns]
        refs += [c.column for c in self.check_constraints if c.column is not None]
        missing = sorted(set(refs) - own)
        if missing:
            raise ValueError(f"{self.id} references columns it does not have: {missing}")
        for member in [*(c.id for c in self.columns), *indexes]:
            if parent_object_id(member) != self.id:
                raise ValueError(f"{member} does not belong to {self.id}")
        for key in self.key_constraints:
            if key.index not in indexes:
                raise ValueError(f"{key.id} names a missing index {key.index}")
        return self


class View(_HasDefinition):
    """A view."""

    id: ObjectId
    schema_id: SchemaId
    name: Name
    description: str | None = None
    columns: tuple[Column, ...]
    schema_bound: bool = False

    @field_validator("columns")
    @classmethod
    def _sort_columns(cls, columns: tuple[Column, ...]) -> tuple[Column, ...]:
        return _sorted_columns(columns)

    @model_validator(mode="after")
    def _columns_belong(self) -> View:
        for column in self.columns:
            if parent_object_id(column.id) != self.id:
                raise ValueError(f"{column.id} does not belong to {self.id}")
        return self


class RoutineKind(str, Enum):
    """Kind of programmable object."""

    PROCEDURE = "procedure"
    SCALAR_FUNCTION = "scalar_function"
    TABLE_FUNCTION = "table_function"
    INLINE_TABLE_FUNCTION = "inline_table_function"
    TRIGGER = "trigger"
    OTHER = "other"


class Routine(_HasDefinition):
    """A stored procedure, function or trigger."""

    id: ObjectId
    schema_id: SchemaId
    name: Name
    kind: RoutineKind
    parent: ObjectId | None = None
    """For a trigger: the table or view it fires on."""
    description: str | None = None


class ReferenceScope(str, Enum):
    """Where a referenced object lives. Cross-database targets are flagged, never resolved."""

    LOCAL = "local"
    CROSS_DATABASE = "cross_database"
    CROSS_SERVER = "cross_server"
    COLUMN_METHOD = "column_method"
    """An XML or UDT method call such as `Demographics.exist(...)`. SQL Server records it as a
    multi-part name, so the name parts are a column or alias and a method, not an object."""


class QualifiedName(_Model):
    """A multi-part name exactly as written in SQL; missing parts are null."""

    server: Name | None = None
    """Linked server name. Dropped by --redact-server."""
    database: Name | None = None
    schema_name: Name | None = None
    name: Name


class Reference(_Model):
    """A reference from SQL to another object."""

    scope: ReferenceScope
    name: QualifiedName
    resolved: ObjectId | None = None
    """The local object the name resolves to; only for local scope, null if it does not exist."""

    @model_validator(mode="after")
    def _scope_rules(self) -> Reference:
        if self.scope is not ReferenceScope.LOCAL and self.resolved is not None:
            raise ValueError("only local references are resolved")
        if self.scope is ReferenceScope.CROSS_DATABASE and self.name.database is None:
            raise ValueError("a cross-database reference must name its database")
        return self


class Synonym(_Model):
    """A synonym and the object it points to."""

    id: ObjectId
    schema_id: SchemaId
    name: Name
    target: Reference


class ReferentialAction(str, Enum):
    """What a foreign key does on delete or update."""

    NO_ACTION = "no_action"
    CASCADE = "cascade"
    SET_NULL = "set_null"
    SET_DEFAULT = "set_default"


class Relationship(_Model):
    """A declared foreign key. Inferred relationships never appear here (see Snapshot)."""

    id: ForeignKeyId
    name: Name
    edge: EdgeIdStr
    """Derived from the ordered column IDs; stable across constraint renames."""
    from_object: ObjectId
    from_columns: tuple[ColumnId, ...] = Field(min_length=1)
    to_object: ObjectId
    to_columns: tuple[ColumnId, ...] = Field(min_length=1)
    on_delete: ReferentialAction = ReferentialAction.NO_ACTION
    on_update: ReferentialAction = ReferentialAction.NO_ACTION
    disabled: bool = False
    trusted: bool = True

    @model_validator(mode="after")
    def _consistent(self) -> Relationship:
        if self.edge != edge_id(self.from_columns, self.to_columns):
            raise ValueError(f"{self.id}: edge does not match its columns")
        if parent_object_id(self.from_columns[0]) != self.from_object:
            raise ValueError(f"{self.id}: from_columns do not belong to from_object")
        if parent_object_id(self.to_columns[0]) != self.to_object:
            raise ValueError(f"{self.id}: to_columns do not belong to to_object")
        return self


class Dependency(_Model):
    """One object's SQL refers to another (sys.sql_expression_dependencies)."""

    from_object: ObjectId
    target: Reference


class Section(str, Enum):
    """A part of the snapshot that extraction can skip."""

    SCHEMAS = "schemas"
    TABLES = "tables"
    VIEWS = "views"
    ROUTINES = "routines"
    SYNONYMS = "synonyms"
    RELATIONSHIPS = "relationships"
    DEPENDENCIES = "dependencies"
    DEFINITIONS = "definitions"
    DESCRIPTIONS = "descriptions"
    ROW_COUNTS = "row_counts"
    QUERY_HISTORY = "query_history"
    JOIN_EVIDENCE = "join_evidence"


class ExtractionWarning(_Model):
    """Something extraction could not read, usually a missing permission."""

    section: Section
    code: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$")]
    message: str


class RowCount(_Model):
    """Approximate row count of a table, from partition statistics (never from the table)."""

    object: ObjectId
    rows: Count
    reserved_bytes: Count | None = None
    """Space reserved by the table and all its indexes, from the same statistics."""


class RowCounts(_Model):
    """Optional section."""

    items: tuple[RowCount, ...]

    @field_validator("items")
    @classmethod
    def _sort(cls, items: tuple[RowCount, ...]) -> tuple[RowCount, ...]:
        return _sorted_unique(items, lambda r: r.object, "row count")


class ObjectUsage(_Model):
    """How often an object ran in the Query Store window. Counts only, never query text."""

    object: ObjectId
    execution_count: Count
    last_executed_at: AwareDatetime | None = None


class QueryHistory(_Model):
    """Optional section."""

    source: Literal["query_store"] = "query_store"
    window_start: AwareDatetime | None = None
    window_end: AwareDatetime | None = None
    items: tuple[ObjectUsage, ...]

    @field_validator("items")
    @classmethod
    def _sort(cls, items: tuple[ObjectUsage, ...]) -> tuple[ObjectUsage, ...]:
        return _sorted_unique(items, lambda u: u.object, "object usage")


class EvidenceSource(str, Enum):
    """Where a join was seen."""

    CODE = "code"
    """Module definitions (views, procedures, functions, triggers)."""
    QUERY_HISTORY = "query_history"
    """Query Store query text, parsed at extract time and then discarded."""


class JoinEvidenceEntry(_Model):
    """Two columns compared by equality in a join. The pair is unordered, so it is stored
    with from_column < to_column and the same join always produces one entry."""

    from_column: ColumnId
    to_column: ColumnId
    source: EvidenceSource
    count: Annotated[int, Field(ge=1)]
    """Number of distinct modules or queries that contain this join."""

    @model_validator(mode="after")
    def _canonical(self) -> JoinEvidenceEntry:
        if not self.from_column < self.to_column:
            raise ValueError("join evidence pairs must have from_column < to_column")
        return self


class JoinEvidence(_Model):
    """Optional section. Typed join pairs only: no query text is ever stored."""

    entries: tuple[JoinEvidenceEntry, ...]
    parse_failure_count: Count
    """Statements the parser could not read; they contribute no entries."""

    @field_validator("entries")
    @classmethod
    def _sort(cls, entries: tuple[JoinEvidenceEntry, ...]) -> tuple[JoinEvidenceEntry, ...]:
        return _sorted_unique(
            entries,
            lambda e: f"{e.from_column}\n{e.to_column}\n{e.source.value}",
            "join evidence entry",
        )


class Snapshot(_Model):
    """Schema Map snapshot, format v1.

    Readers must ignore fields they do not know. Minor versions only add optional fields.
    Reserved for v1.1: a top-level `inferred_relationships` list (with score and evidence),
    kept separate from `relationships` so a v1.0 reader never shows a guess as a declared key.
    Optional sections (row_counts, query_history, join_evidence) are null when not collected.
    """

    format: Literal["schemamap.snapshot"] = FORMAT
    format_version: Annotated[str, Field(pattern=r"^1\.(0|[1-9][0-9]*)$")] = FORMAT_VERSION
    generator: Generator
    captured_at: AwareDatetime
    """UTC time of extraction."""
    source: SourceInfo
    schemas: tuple[Schema, ...] = ()
    tables: tuple[Table, ...] = ()
    views: tuple[View, ...] = ()
    routines: tuple[Routine, ...] = ()
    synonyms: tuple[Synonym, ...] = ()
    relationships: tuple[Relationship, ...] = ()
    dependencies: tuple[Dependency, ...] = ()
    warnings: tuple[ExtractionWarning, ...] = ()
    row_counts: RowCounts | None = None
    """Optional section; null when not collected."""
    query_history: QueryHistory | None = None
    """Optional section; null when not collected."""
    join_evidence: JoinEvidence | None = None
    """Optional section; null when not collected."""

    @field_validator("captured_at")
    @classmethod
    def _utc(cls, value: AwareDatetime) -> AwareDatetime:
        if value.utcoffset() != timedelta(0):
            raise ValueError("captured_at must be in UTC")
        return value

    @field_validator("schemas", "tables", "views", "routines", "synonyms", "relationships")
    @classmethod
    def _sort_by_id(cls, items: tuple[IdT, ...]) -> tuple[IdT, ...]:
        return _sorted_unique(items, _by_id, "ID")

    @field_validator("dependencies", "warnings")
    @classmethod
    def _sort_by_content(cls, items: tuple[M, ...]) -> tuple[M, ...]:
        return _sorted_unique(items, _by_content, "entry")

    @model_validator(mode="after")
    def _references_resolve(self) -> Snapshot:
        _check_references(self)
        return self


def _parts(any_id: str) -> tuple[str, ...]:
    parsed = parse_id(any_id)
    return parsed.parts if isinstance(parsed, NameId) else ()


def _check_references(snap: Snapshot) -> None:
    schemas = {s.id for s in snap.schemas}
    owners: list[Table | View | Routine | Synonym] = [
        *snap.tables,
        *snap.views,
        *snap.routines,
        *snap.synonyms,
    ]
    owned = [(o.id, o.schema_id) for o in owners]
    objects = {oid for oid, _ in owned}
    if len(objects) != len(owned):
        raise ValueError("object IDs must be unique across tables, views, routines and synonyms")
    for oid, owner in owned:
        if owner not in schemas:
            raise ValueError(f"{oid} is in unknown schema {owner}")
        if _parts(oid)[0] != _parts(owner)[0]:
            raise ValueError(f"{oid} does not belong to {owner}")
    relations: list[Table | View] = [*snap.tables, *snap.views]
    columns = {c.id for t in relations for c in t.columns}

    object_refs = [r.from_object for r in snap.relationships]
    object_refs += [r.to_object for r in snap.relationships]
    object_refs += [d.from_object for d in snap.dependencies]
    object_refs += [d.target.resolved for d in snap.dependencies if d.target.resolved]
    object_refs += [s.target.resolved for s in snap.synonyms if s.target.resolved]
    object_refs += [r.parent for r in snap.routines if r.parent]
    if snap.row_counts:
        object_refs += [r.object for r in snap.row_counts.items]
    if snap.query_history:
        object_refs += [u.object for u in snap.query_history.items]
    column_refs = [c for r in snap.relationships for c in (*r.from_columns, *r.to_columns)]
    if snap.join_evidence:
        column_refs += [c for e in snap.join_evidence.entries for c in (e.from_column, e.to_column)]

    missing = sorted((set(object_refs) - objects) | (set(column_refs) - columns))
    if missing:
        raise ValueError(f"references to objects or columns not in the snapshot: {missing}")

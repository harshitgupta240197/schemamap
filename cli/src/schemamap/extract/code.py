"""Views, routines, synonyms and the dependencies between objects."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from schemamap.connect import MetadataExecutor
from schemamap.extract.rows import (
    ColumnRow,
    DependencyRow,
    RoutineRow,
    SynonymRow,
    ViewRow,
)
from schemamap.extract.tables import build_column
from schemamap.queries import QueryName
from schemamap.snapshot.ids import object_id, schema_id
from schemamap.snapshot.models import (
    Column,
    DefinitionStatus,
    Dependency,
    QualifiedName,
    Reference,
    ReferenceScope,
    Routine,
    RoutineKind,
    Synonym,
    View,
)

_ROUTINE_KINDS = {
    "P": RoutineKind.PROCEDURE,
    "PC": RoutineKind.PROCEDURE,
    "FN": RoutineKind.SCALAR_FUNCTION,
    "FS": RoutineKind.SCALAR_FUNCTION,
    "TF": RoutineKind.TABLE_FUNCTION,
    "FT": RoutineKind.TABLE_FUNCTION,
    "IF": RoutineKind.INLINE_TABLE_FUNCTION,
    "TR": RoutineKind.TRIGGER,
    "TA": RoutineKind.TRIGGER,
}


def definition_state(
    definition: str | None, *, encrypted: bool, has_module: bool = True
) -> tuple[str | None, DefinitionStatus]:
    """The definition to store and why it is missing, if it is.

    A module with no text is encrypted, has no T-SQL body (CLR), or is hidden from this
    login by a missing permission.
    """
    if definition is not None:
        return definition, DefinitionStatus.AVAILABLE
    if encrypted:
        return None, DefinitionStatus.ENCRYPTED
    if not has_module:
        return None, DefinitionStatus.NOT_APPLICABLE
    return None, DefinitionStatus.NOT_PERMITTED


def build_views(views: Iterable[ViewRow], columns: Iterable[ColumnRow]) -> tuple[View, ...]:
    """Assemble views with their columns, sorted by ID. Columns of unknown views are ignored."""
    columns_by_view: dict[tuple[str, str], list[Column]] = defaultdict(list)
    for column in columns:
        columns_by_view[(column.schema_name, column.table_name)].append(build_column(column))
    built = []
    for row in views:
        definition, status = definition_state(row.definition, encrypted=bool(row.is_encrypted))
        built.append(
            View(
                id=object_id(row.schema_name, row.view_name),
                schema_id=schema_id(row.schema_name),
                name=row.view_name,
                columns=tuple(columns_by_view[(row.schema_name, row.view_name)]),
                schema_bound=bool(row.is_schema_bound),
                definition=definition,
                definition_status=status,
            )
        )
    return tuple(sorted(built, key=lambda v: v.id))


def build_routines(rows: Iterable[RoutineRow]) -> tuple[Routine, ...]:
    """Map procedure, function and trigger rows to routines, sorted by ID."""
    built = []
    for row in rows:
        definition, status = definition_state(
            row.definition, encrypted=bool(row.is_encrypted), has_module=bool(row.has_module)
        )
        parent = (
            object_id(row.parent_schema_name, row.parent_name)
            if row.parent_schema_name is not None and row.parent_name is not None
            else None
        )
        built.append(
            Routine(
                id=object_id(row.schema_name, row.routine_name),
                schema_id=schema_id(row.schema_name),
                name=row.routine_name,
                kind=_ROUTINE_KINDS.get(row.type_code.strip(), RoutineKind.OTHER),
                parent=parent,
                definition=definition,
                definition_status=status,
            )
        )
    return tuple(sorted(built, key=lambda r: r.id))


def classify_scope(
    server: str | None,
    database: str | None,
    *,
    ambiguous: bool = False,
    catalog_resolved: bool = True,
) -> ReferenceScope:
    """Where a referenced name lives.

    SQL Server records `Demographics.exist(...)` and `s.Demographics.value(...)` as two- and
    three-part names, so a method call looks like a reference to a database or schema. The
    catalog marks these rows `is_ambiguous` and cannot resolve them to an object. Both signals
    are required: `is_ambiguous` alone also flags genuine function calls that resolve, and
    "unresolved" alone also covers real references to a missing object or database. A
    `sys.databases` lookup is not used: an alias can share a database's name, and a login may
    not see every database. A server part always means a linked server.
    """
    if server is not None:
        return ReferenceScope.CROSS_SERVER
    if ambiguous and not catalog_resolved:
        return ReferenceScope.COLUMN_METHOD
    if database is not None:
        return ReferenceScope.CROSS_DATABASE
    return ReferenceScope.LOCAL


def build_reference(
    server: str | None,
    database: str | None,
    schema: str | None,
    name: str,
    resolved_schema: str | None,
    resolved_name: str | None,
    *,
    ambiguous: bool = False,
    catalog_resolved: bool = True,
) -> Reference:
    """A reference exactly as written. Only a local name that exists carries ``resolved``."""
    scope = classify_scope(server, database, ambiguous=ambiguous, catalog_resolved=catalog_resolved)
    resolved = (
        object_id(resolved_schema, resolved_name)
        if scope is ReferenceScope.LOCAL and resolved_schema is not None and resolved_name
        else None
    )
    return Reference(
        scope=scope,
        name=QualifiedName(server=server, database=database, schema_name=schema, name=name),
        resolved=resolved,
    )


def build_synonyms(rows: Iterable[SynonymRow]) -> tuple[Synonym, ...]:
    """Map synonym rows to synonyms, sorted by ID.

    Target parts come from the catalog's own name parser, so a target that names a database
    or linked server stays cross_database or cross_server and unresolved.
    """
    built = []
    for row in rows:
        built.append(
            Synonym(
                id=object_id(row.schema_name, row.synonym_name),
                schema_id=schema_id(row.schema_name),
                name=row.synonym_name,
                target=build_reference(
                    row.target_server,
                    row.target_database,
                    row.target_schema,
                    row.target_name,
                    row.resolved_schema_name,
                    row.resolved_name,
                ),
            )
        )
    return tuple(sorted(built, key=lambda s: s.id))


def build_dependencies(rows: Iterable[DependencyRow]) -> tuple[Dependency, ...]:
    """Map dependency rows to dependencies, dropping repeats (one row exists per column).

    Method calls on XML or UDT columns are kept, with scope ``column_method``: nothing is
    dropped, so a genuine reference can never be lost by a wrong guess.
    """
    unique: dict[str, Dependency] = {}
    for row in rows:
        dependency = Dependency(
            from_object=object_id(row.from_schema_name, row.from_name),
            target=build_reference(
                row.target_server,
                row.target_database,
                row.target_schema,
                row.target_name,
                row.resolved_schema_name,
                row.resolved_name,
                ambiguous=bool(row.is_ambiguous),
                catalog_resolved=bool(row.has_referenced_id),
            ),
        )
        unique[dependency.model_dump_json()] = dependency
    return tuple(unique[key] for key in sorted(unique))


def extract_views(executor: MetadataExecutor) -> tuple[View, ...]:
    """Read every user view with its columns and definition."""
    return build_views(
        (ViewRow(*row) for row in executor.run(QueryName.VIEWS)),
        (ColumnRow(*row) for row in executor.run(QueryName.VIEW_COLUMNS)),
    )


def extract_routines(executor: MetadataExecutor) -> tuple[Routine, ...]:
    """Read every user procedure, function and DML trigger."""
    return build_routines(RoutineRow(*row) for row in executor.run(QueryName.ROUTINES))


def extract_synonyms(executor: MetadataExecutor) -> tuple[Synonym, ...]:
    """Read every user synonym."""
    return build_synonyms(SynonymRow(*row) for row in executor.run(QueryName.SYNONYMS))


def extract_dependencies(executor: MetadataExecutor) -> tuple[Dependency, ...]:
    """Read what every user object's SQL refers to."""
    return build_dependencies(DependencyRow(*row) for row in executor.run(QueryName.DEPENDENCIES))

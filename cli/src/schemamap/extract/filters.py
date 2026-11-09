"""Schema filters and definition omission: pure functions over a finished extraction.

A filter removes objects, then everything that pointed at a removed object, so the snapshot
model's integrity rules still hold. Nothing here touches the database.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from schemamap.extract.database import DatabaseExtraction
from schemamap.snapshot.models import (
    AppliedFilters,
    CheckConstraint,
    Column,
    ComputedColumn,
    DefaultConstraint,
    DefinitionStatus,
    ExtractionWarning,
    Index,
    Routine,
    RowCounts,
    Section,
    Table,
    View,
)

DROPPED_CODE = "references_dropped"
SCHEMA_NOT_FOUND_CODE = "schema_not_found"


@dataclass(frozen=True)
class SchemaFilter:
    """Which schemas to keep. Names compare case-insensitively, like SQL Server's default."""

    include: tuple[str, ...] = ()
    exclude: tuple[str, ...] = ()

    @property
    def active(self) -> bool:
        """True when the filter removes anything."""
        return bool(self.include or self.exclude)

    def keeps(self, name: str) -> bool:
        """Whether a schema with this name stays in the snapshot."""
        folded = name.casefold()
        if self.include and folded not in {n.casefold() for n in self.include}:
            return False
        return folded not in {n.casefold() for n in self.exclude}

    def recorded(self) -> AppliedFilters | None:
        """The filters as stored in the snapshot, or None when there are none."""
        if not self.active:
            return None
        return AppliedFilters(
            schemas=tuple(dict.fromkeys(self.include)),
            exclude_schemas=tuple(dict.fromkeys(self.exclude)),
        )


def apply_schema_filter(
    extraction: DatabaseExtraction, schema_filter: SchemaFilter
) -> DatabaseExtraction:
    """Remove excluded schemas and objects, and every reference that pointed at them.

    Adds one warning for the unknown schema names given, and one stating how many
    relationships, dependencies, synonyms and routines were dropped to keep the model whole.
    """
    if not schema_filter.active:
        return extraction
    kept_schemas = tuple(s for s in extraction.schemas if schema_filter.keeps(s.name))
    kept_ids = {s.id for s in kept_schemas}
    tables = tuple(t for t in extraction.tables if t.schema_id in kept_ids)
    views = tuple(v for v in extraction.views if v.schema_id in kept_ids)
    objects = {t.id for t in tables} | {v.id for v in views}

    routines_here = tuple(r for r in extraction.routines if r.schema_id in kept_ids)
    routines = tuple(r for r in routines_here if r.parent is None or r.parent in objects)
    synonyms_here = tuple(s for s in extraction.synonyms if s.schema_id in kept_ids)
    reachable = objects | {r.id for r in routines} | {s.id for s in synonyms_here}
    synonyms = tuple(
        s for s in synonyms_here if s.target.resolved is None or s.target.resolved in reachable
    )
    present = objects | {r.id for r in routines} | {s.id for s in synonyms}
    relationships = tuple(
        r for r in extraction.relationships if r.from_object in objects and r.to_object in objects
    )
    dependencies = tuple(
        d
        for d in extraction.dependencies
        if d.from_object in present and (d.target.resolved is None or d.target.resolved in present)
    )
    row_counts = extraction.row_counts
    if row_counts is not None:
        row_counts = RowCounts(items=tuple(i for i in row_counts.items if i.object in objects))

    dropped = (
        len(extraction.relationships)
        - len(relationships)
        + len(extraction.dependencies)
        - len(dependencies)
        + len(synonyms_here)
        - len(synonyms)
        + len(routines_here)
        - len(routines)
    )
    warnings = list(extraction.warnings)
    warnings.extend(_unknown_schema_warnings(extraction, schema_filter))
    if dropped > 0:
        warnings.append(
            ExtractionWarning(
                section=Section.FILTERS,
                code=DROPPED_CODE,
                message=(
                    f"Schema filters dropped {dropped} relationship, dependency, synonym or "
                    "routine entries that pointed at, or came from, omitted objects."
                ),
            )
        )
    return replace(
        extraction,
        schemas=kept_schemas,
        tables=tables,
        views=views,
        routines=routines,
        synonyms=synonyms,
        relationships=relationships,
        dependencies=dependencies,
        row_counts=row_counts,
        warnings=tuple(warnings),
    )


def _unknown_schema_warnings(
    extraction: DatabaseExtraction, schema_filter: SchemaFilter
) -> list[ExtractionWarning]:
    existing = {s.name.casefold() for s in extraction.schemas}
    unknown = sorted(
        {
            n
            for n in (*schema_filter.include, *schema_filter.exclude)
            if n.casefold() not in existing
        }
    )
    return [
        ExtractionWarning(
            section=Section.FILTERS,
            code=SCHEMA_NOT_FOUND_CODE,
            message=f"Schema {name!r} was not found in the database (or is not readable).",
        )
        for name in unknown
    ]


def omit_definitions(extraction: DatabaseExtraction) -> DatabaseExtraction:
    """Remove every definition text: modules, computed columns, defaults, checks and filters.

    A module whose text was available becomes ``omitted``; one that was already encrypted or
    not permitted keeps that status, since it says something true about the database.
    """
    return replace(
        extraction,
        tables=tuple(_table_without_definitions(t) for t in extraction.tables),
        views=tuple(_view_without_definitions(v) for v in extraction.views),
        routines=tuple(_routine_without_definition(r) for r in extraction.routines),
    )


def _status_after_omission(status: DefinitionStatus) -> DefinitionStatus:
    return DefinitionStatus.OMITTED if status is DefinitionStatus.AVAILABLE else status


def _routine_without_definition(routine: Routine) -> Routine:
    return routine.model_copy(
        update={
            "definition": None,
            "definition_status": _status_after_omission(routine.definition_status),
        }
    )


def _view_without_definitions(view: View) -> View:
    return view.model_copy(
        update={
            "definition": None,
            "definition_status": _status_after_omission(view.definition_status),
            "columns": tuple(_column_without_definitions(c) for c in view.columns),
        }
    )


def _column_without_definitions(column: Column) -> Column:
    computed: ComputedColumn | None = None
    if column.computed is not None:
        computed = column.computed.model_copy(update={"definition": None})
    default: DefaultConstraint | None = None
    if column.default is not None:
        default = column.default.model_copy(update={"definition": None})
    return column.model_copy(update={"computed": computed, "default": default})


def _table_without_definitions(table: Table) -> Table:
    return table.model_copy(
        update={
            "columns": tuple(_column_without_definitions(c) for c in table.columns),
            "indexes": tuple(_index_without_filter(i) for i in table.indexes),
            "check_constraints": tuple(
                _check_without_definition(c) for c in table.check_constraints
            ),
        }
    )


def _index_without_filter(index: Index) -> Index:
    return index.model_copy(update={"filter": None})


def _check_without_definition(check: CheckConstraint) -> CheckConstraint:
    return check.model_copy(update={"definition": None})

"""Reads every section of a database through independent, permission-aware steps."""

from __future__ import annotations

from dataclasses import dataclass

from schemamap.connect import (
    MetadataExecutor,
    Permission,
    database_user,
    held_permissions,
    query_store_state,
)
from schemamap.extract.code import (
    extract_dependencies,
    extract_routines,
    extract_synonyms,
    extract_views,
)
from schemamap.extract.relationships import extract_relationships
from schemamap.extract.row_counts import extract_row_counts
from schemamap.extract.runner import Requirement, SectionObserver, SectionRunner
from schemamap.extract.schemas import extract_schemas
from schemamap.extract.tables import extract_tables
from schemamap.extract.visibility import (
    Visibility,
    assess_visibility,
    no_visible_objects_error,
    partial_visibility_warning,
)
from schemamap.snapshot.models import (
    Dependency,
    ExtractionWarning,
    QueryStoreState,
    Relationship,
    Routine,
    RowCounts,
    Schema,
    Section,
    Synonym,
    Table,
    View,
)

DEPENDENCIES_REQUIREMENT = Requirement(
    Permission.SELECT_DEPENDENCIES,
    "Dependency and impact information was skipped.",
)
ROW_COUNTS_REQUIREMENT = Requirement(
    Permission.VIEW_DATABASE_STATE,
    "Row counts and sizes were skipped.",
)


@dataclass(frozen=True)
class DatabaseExtraction:
    """Everything read from one database; a skipped section is empty (or None) with a warning."""

    schemas: tuple[Schema, ...]
    tables: tuple[Table, ...]
    views: tuple[View, ...]
    routines: tuple[Routine, ...]
    synonyms: tuple[Synonym, ...]
    relationships: tuple[Relationship, ...]
    dependencies: tuple[Dependency, ...]
    row_counts: RowCounts | None
    query_store: QueryStoreState
    warnings: tuple[ExtractionWarning, ...]


SECTION_COUNT = 8
"""How many sections extract_database runs, for progress totals."""


def extract_database(
    executor: MetadataExecutor, observer: SectionObserver | None = None
) -> DatabaseExtraction:
    """Run every section, skipping (with one warning each) those the login cannot read.

    Raises NoVisibleObjectsError when the login lacks VIEW DEFINITION and sees no objects, and
    adds a ``partial_visibility`` warning when it lacks it but sees some.
    """
    held = held_permissions(executor)
    runner = SectionRunner(held, observer)
    schemas: tuple[Schema, ...] = runner.run(Section.SCHEMAS, lambda: extract_schemas(executor), ())
    tables: tuple[Table, ...] = runner.run(Section.TABLES, lambda: extract_tables(executor), ())
    views: tuple[View, ...] = runner.run(Section.VIEWS, lambda: extract_views(executor), ())
    routines: tuple[Routine, ...] = runner.run(
        Section.ROUTINES, lambda: extract_routines(executor), ()
    )
    synonyms: tuple[Synonym, ...] = runner.run(
        Section.SYNONYMS, lambda: extract_synonyms(executor), ()
    )
    relationships: tuple[Relationship, ...] = runner.run(
        Section.RELATIONSHIPS, lambda: extract_relationships(executor), ()
    )
    dependencies: tuple[Dependency, ...] = runner.run(
        Section.DEPENDENCIES,
        lambda: extract_dependencies(executor),
        (),
        DEPENDENCIES_REQUIREMENT,
    )
    table_ids = [table.id for table in tables]
    row_counts: RowCounts | None = runner.run(
        Section.ROW_COUNTS,
        lambda: extract_row_counts(executor, table_ids),
        None,
        ROW_COUNTS_REQUIREMENT,
    )
    visibility = assess_visibility(
        view_definition_held=Permission.VIEW_DEFINITION in held,
        tables=len(tables),
        other_objects=len(views) + len(routines) + len(synonyms),
    )
    if visibility is Visibility.NONE:
        raise no_visible_objects_error(database_user(executor))
    warnings = runner.warnings
    if visibility is Visibility.PARTIAL:
        warnings = (partial_visibility_warning(), *warnings)
    return DatabaseExtraction(
        schemas=schemas,
        tables=tables,
        views=views,
        routines=routines,
        synonyms=synonyms,
        relationships=relationships,
        dependencies=dependencies,
        row_counts=row_counts,
        query_store=query_store_state(held, executor),
        warnings=warnings,
    )

"""The allowlist every query file must pass: one SELECT over system objects, nothing else.

The executor calls ``check_query`` before every run, and the test suite checks every file in
``queries/``. Any change that widens these lists needs a reason in docs/DECISIONS.md.
"""

from __future__ import annotations

import re

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError

from schemamap.errors import QueryRefusedError
from schemamap.queries import query_params

SYSTEM_SCHEMAS = frozenset({"sys", "information_schema"})

# sys.* objects named with these prefixes expose server state rather than catalog metadata,
# so each one must be approved by name below.
GATED_PREFIXES = ("dm_", "query_store_")

# A view is added here, with a reason in docs/DECISIONS.md, in the crumb whose query first
# uses it.
APPROVED_GATED_VIEWS: frozenset[str] = frozenset({"sys.dm_db_partition_stats"})

# Schema-qualified functions (table-valued or scalar), by lower-case two-part name.
APPROVED_SYSTEM_FUNCTIONS = frozenset({"sys.fn_my_permissions"})

# Unqualified built-in functions, by upper-case T-SQL name.
APPROVED_FUNCTIONS = frozenset(
    {
        # Metadata
        "COL_NAME",
        "COLUMNPROPERTY",
        "DATABASEPROPERTYEX",
        "DB_ID",
        "DB_NAME",
        "HAS_PERMS_BY_NAME",
        "INDEXPROPERTY",
        "OBJECT_DEFINITION",
        "OBJECT_ID",
        "OBJECT_NAME",
        "OBJECT_SCHEMA_NAME",
        "OBJECTPROPERTY",
        "OBJECTPROPERTYEX",
        "PARSENAME",
        "SCHEMA_ID",
        "SCHEMA_NAME",
        "SERVERPROPERTY",
        "TYPE_NAME",
        # Conversion and null handling
        "CAST",
        "COALESCE",
        "CONVERT",
        "IIF",
        "ISNULL",
        "NULLIF",
        "TRY_CAST",
        # Strings
        "CHARINDEX",
        "CONCAT",
        "LEFT",
        "LEN",
        "LOWER",
        "LTRIM",
        "REPLACE",
        "RIGHT",
        "RTRIM",
        "SUBSTRING",
        "UPPER",
        # Aggregates and ranking
        "COUNT",
        "COUNT_BIG",
        "MAX",
        "MIN",
        "ROW_NUMBER",
        "STRING_AGG",
        "SUM",
    }
)

# Rowset functions that reach outside the database: refused with their own reason.
EXTERNAL_DATA_FUNCTIONS = frozenset({"OPENDATASOURCE", "OPENQUERY", "OPENROWSET", "OPENXML"})

# Nodes sqlglot models as functions that are really SQL syntax (AND, OR, EXISTS, CASE).
_SYNTAX_NODES = (exp.Connector, exp.Exists, exp.Case)

_FORBIDDEN_STATEMENTS: dict[type[exp.Expr], str] = {
    exp.Insert: "INSERT",
    exp.Update: "UPDATE",
    exp.Delete: "DELETE",
    exp.Merge: "MERGE",
    exp.Execute: "EXEC",
    exp.ExecuteSql: "EXEC",
    exp.Command: "a command",
    exp.Create: "CREATE",
    exp.Alter: "ALTER",
    exp.Drop: "DROP",
    exp.TruncateTable: "TRUNCATE",
    exp.Declare: "DECLARE",
    exp.Set: "SET",
    exp.Use: "USE",
}

_LEADING_WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def violations(sql: str) -> list[str]:
    """Every reason ``sql`` is not allowed, in a stable order; empty when it is allowed."""
    try:
        statements = [s for s in sqlglot.parse(sql, read="tsql") if s is not None]
    except SqlglotError as exc:
        first_line = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        return [f"cannot be parsed as T-SQL: {first_line}"]
    if len(statements) != 1:
        return [f"must contain exactly one statement, found {len(statements)}"]
    statement = statements[0]

    problems: list[str] = []
    if not isinstance(statement, (exp.Select, exp.SetOperation)) and not isinstance(
        statement, tuple(_FORBIDDEN_STATEMENTS)
    ):
        problems.append(f"{statement.key.upper()} statement is not allowed; only SELECT")
    for node in statement.walk():
        problems.extend(_node_violations(node))
    problems.extend(_parameter_violations(sql, statement))
    return list(dict.fromkeys(problems))


def check_query(sql: str) -> None:
    """Raise QueryRefusedError listing every violation, or return if ``sql`` is allowed."""
    problems = violations(sql)
    if problems:
        raise QueryRefusedError("Query is not on the allowlist: " + "; ".join(problems) + ".")


def _node_violations(node: exp.Expr) -> list[str]:
    for kind, name in _FORBIDDEN_STATEMENTS.items():
        if isinstance(node, kind):
            return [f"{name} is not allowed; only SELECT"]
    if isinstance(node, exp.Select) and node.args.get("into"):
        return ["SELECT INTO is not allowed"]
    if isinstance(node, exp.Table):
        problem = _table_violation(node)
        return [problem] if problem else []
    if isinstance(node, (exp.Parameter, exp.SessionParameter)):
        if isinstance(node.parent, (exp.Table, exp.Parameter, exp.SessionParameter)):
            return []  # reported as a table variable, or as the enclosing variable
        return [f"variables such as {node.sql(dialect='tsql')} are not allowed"]
    if isinstance(node, exp.Dot) and isinstance(node.expression, exp.Func):
        return _qualified_function_violation(node)
    if isinstance(node, exp.Func):
        return _function_violation(node)
    return []


def _function_name(node: exp.Func) -> str:
    """The upper-case T-SQL name of a function call, whatever node type sqlglot chose."""
    if isinstance(node, exp.Anonymous):
        return str(node.name).upper()
    rendered = node.sql(dialect="tsql")
    match = _LEADING_WORD.match(rendered)
    return match.group(0).upper() if match else rendered


def _function_violation(node: exp.Func) -> list[str]:
    if isinstance(node, _SYNTAX_NODES):
        return []
    if isinstance(node.parent, exp.Table) and node.parent.this is node:
        return []  # a rowset function; checked as a table source
    if isinstance(node.parent, exp.Dot) and node.parent.expression is node:
        return []  # a schema-qualified call; checked on the Dot
    name = _function_name(node)
    if name in EXTERNAL_DATA_FUNCTIONS:
        return [f"{name} reads data from outside the database"]
    if name not in APPROVED_FUNCTIONS:
        return [f"function {name} is not on the approved list"]
    return []


def _qualified_function_violation(dot: exp.Dot) -> list[str]:
    function = dot.expression
    assert isinstance(function, exp.Func)  # guaranteed by the caller
    if not isinstance(dot.this, exp.Identifier):
        return [f"function {dot.sql(dialect='tsql')} uses a multi-part name"]
    qualified = f"{dot.this.name}.{_function_name(function)}".lower()
    if qualified not in APPROVED_SYSTEM_FUNCTIONS:
        return [f"function {qualified} is not on the approved list"]
    return []


def _table_violation(table: exp.Table) -> str | None:
    source = table.this
    schema = table.db.lower()
    label = ".".join(part.sql(dialect="tsql") for part in table.parts)
    if isinstance(source, exp.Dot):
        return f"four-part name {label} reaches a linked server"
    if table.catalog:
        return f"three-part name {label} reaches another database"
    if isinstance(source, (exp.Parameter, exp.SessionParameter)):
        return f"table variable {label} is not allowed"
    if isinstance(source, exp.Func):
        return _rowset_function_violation(source, schema)
    name = table.name
    if name.startswith("#") or source.args.get("temporary") or source.args.get("global_"):
        return f"temp table {label} is not allowed"
    if not schema:
        if name.lower() in _ctes_in_scope(table):
            return None
        return f"unqualified name {label} is not a system object; write sys.{name}"
    if schema not in SYSTEM_SCHEMAS:
        return f"{label} is not a system object"
    qualified = f"{schema}.{name.lower()}"
    if (
        schema == "sys"
        and name.lower().startswith(GATED_PREFIXES)
        and qualified not in APPROVED_GATED_VIEWS
    ):
        return f"{qualified} is not on the approved list of DMVs and Query Store views"
    return None


def _rowset_function_violation(function: exp.Func, schema: str) -> str | None:
    name = _function_name(function)
    if name in EXTERNAL_DATA_FUNCTIONS:
        return f"{name} reads data from outside the database"
    qualified = f"{schema}.{name.lower()}" if schema else name
    if qualified not in APPROVED_SYSTEM_FUNCTIONS:
        return f"table-valued function {qualified} is not on the approved list"
    return None


def _ctes_in_scope(table: exp.Table) -> set[str]:
    """Lower-case names of the CTEs visible where ``table`` is referenced."""
    names: set[str] = set()
    node = table.parent
    while node is not None:
        if isinstance(node, exp.Query):
            names.update(cte.alias.lower() for cte in node.ctes)
        node = node.parent
    return names


def _parameter_violations(sql: str, statement: exp.Expr) -> list[str]:
    try:
        declared = query_params(sql)
    except QueryRefusedError as exc:
        return [str(exc).rstrip(".")]
    placeholders = list(statement.find_all(exp.Placeholder))
    if any(p.this for p in placeholders):
        return ["only positional ? placeholders are allowed"]
    if len(placeholders) != len(declared):
        return [f"has {len(placeholders)} ? placeholders but declares {len(declared)} parameters"]
    return []

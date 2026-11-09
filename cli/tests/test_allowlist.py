"""The allowlist: every real query passes, and every way out of "metadata only" fails clearly."""

from importlib import resources

import pytest

from schemamap.errors import QueryRefusedError
from schemamap.queries import allowlist
from schemamap.queries.allowlist import APPROVED_FUNCTIONS, check_query, violations


def real_queries() -> list[tuple[str, str]]:
    """Every .sql file on disk, whether or not QueryName lists it."""
    folder = resources.files("schemamap.queries")
    files = [entry for entry in folder.iterdir() if entry.name.endswith(".sql")]
    return sorted((entry.name, entry.read_text(encoding="utf-8")) for entry in files)


def test_real_queries_include_the_doctor_queries() -> None:
    names = {name for name, _ in real_queries()}
    assert {"doctor_permissions.sql", "doctor_query_store.sql", "doctor_server_info.sql"} <= names


@pytest.mark.parametrize(("name", "sql"), real_queries(), ids=[n for n, _ in real_queries()])
def test_every_real_query_passes(name: str, sql: str) -> None:
    assert violations(sql) == [], name
    check_query(sql)


ALLOWED = {
    "catalog view": "SELECT name FROM sys.tables;",
    "bracketed mixed case": "SELECT [name] FROM [SYS].[Tables];",
    "information schema": "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES;",
    "approved table function": (
        "SELECT permission_name FROM sys.fn_my_permissions(NULL, N'DATABASE');"
    ),
    "join and subquery": (
        "SELECT t.name, c.name FROM sys.tables AS t JOIN sys.columns AS c "
        "ON c.object_id = t.object_id WHERE t.schema_id IN (SELECT schema_id FROM sys.schemas);"
    ),
    "cte": "WITH t AS (SELECT name FROM sys.tables) SELECT name FROM t;",
    "recursive cte": (
        "WITH r AS (SELECT object_id FROM sys.objects UNION ALL "
        "SELECT o.object_id FROM sys.objects AS o JOIN r ON r.object_id = o.parent_object_id) "
        "SELECT object_id FROM r;"
    ),
    "union": "SELECT name FROM sys.tables UNION ALL SELECT name FROM sys.views;",
    "exists, case, iif": (
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.indexes) THEN 1 ELSE 0 END AS a, "
        "IIF(1 = 1, 1, 0) AS b FROM sys.tables;"
    ),
    "declared parameters": (
        "-- params: schema_id, name\nSELECT name FROM sys.tables WHERE schema_id = ? AND name = ?;"
    ),
    "question mark inside a literal is not a placeholder": "SELECT N'?' AS q FROM sys.tables;",
}


@pytest.mark.parametrize("sql", ALLOWED.values(), ids=ALLOWED.keys())
def test_allowed_shapes_pass(sql: str) -> None:
    assert violations(sql) == []


# One sample call per approved function, so a sqlglot upgrade that renames a node fails here.
FUNCTION_SAMPLES = {
    "COL_NAME": "COL_NAME(1, 1)",
    "COLUMNPROPERTY": "COLUMNPROPERTY(1, N'x', N'IsIdentity')",
    "DATABASEPROPERTYEX": "DATABASEPROPERTYEX(N'd', N'Status')",
    "DB_ID": "DB_ID()",
    "DB_NAME": "DB_NAME()",
    "HAS_PERMS_BY_NAME": "HAS_PERMS_BY_NAME(NULL, NULL, N'VIEW SERVER STATE')",
    "INDEXPROPERTY": "INDEXPROPERTY(1, N'i', N'IsClustered')",
    "OBJECT_DEFINITION": "OBJECT_DEFINITION(1)",
    "OBJECT_ID": "OBJECT_ID(N'sys.tables')",
    "OBJECT_NAME": "OBJECT_NAME(1)",
    "OBJECT_SCHEMA_NAME": "OBJECT_SCHEMA_NAME(1)",
    "OBJECTPROPERTY": "OBJECTPROPERTY(1, N'IsTable')",
    "OBJECTPROPERTYEX": "OBJECTPROPERTYEX(1, N'BaseType')",
    "PARSENAME": "PARSENAME(N'a.b', 1)",
    "SCHEMA_ID": "SCHEMA_ID()",
    "SCHEMA_NAME": "SCHEMA_NAME(1)",
    "SERVERPROPERTY": "SERVERPROPERTY('Edition')",
    "TYPE_NAME": "TYPE_NAME(1)",
    "CAST": "CAST(1 AS int)",
    "COALESCE": "COALESCE(name, N'')",
    "CONVERT": "CONVERT(int, 1)",
    "IIF": "IIF(1 = 1, 1, 0)",
    "ISNULL": "ISNULL(name, N'')",
    "NULLIF": "NULLIF(name, N'')",
    "TRY_CAST": "TRY_CAST(name AS int)",
    "CHARINDEX": "CHARINDEX(N'a', name)",
    "CONCAT": "CONCAT(name, N'x')",
    "LEFT": "LEFT(name, 2)",
    "LEN": "LEN(name)",
    "LOWER": "LOWER(name)",
    "LTRIM": "LTRIM(name)",
    "REPLACE": "REPLACE(name, N'a', N'b')",
    "RIGHT": "RIGHT(name, 2)",
    "RTRIM": "RTRIM(name)",
    "SUBSTRING": "SUBSTRING(name, 1, 2)",
    "UPPER": "UPPER(name)",
    "COUNT": "COUNT(*)",
    "COUNT_BIG": "COUNT_BIG(*)",
    "MAX": "MAX(name)",
    "MIN": "MIN(name)",
    "ROW_NUMBER": "ROW_NUMBER() OVER (ORDER BY name)",
    "STRING_AGG": "STRING_AGG(name, N',')",
    "SUM": "SUM(object_id)",
}


def test_function_samples_cover_the_approved_list() -> None:
    assert set(FUNCTION_SAMPLES) == APPROVED_FUNCTIONS


@pytest.mark.parametrize("call", FUNCTION_SAMPLES.values(), ids=FUNCTION_SAMPLES.keys())
def test_every_approved_function_passes(call: str) -> None:
    assert violations(f"SELECT {call} AS v FROM sys.objects;") == []


REFUSED = {
    "user table": ("SELECT * FROM dbo.Customers;", "dbo.Customers is not a system object"),
    "user table in a subquery": (
        "SELECT name FROM sys.tables WHERE EXISTS (SELECT 1 FROM Person.Person);",
        "Person.Person is not a system object",
    ),
    "user table in a join": (
        "SELECT t.name FROM sys.tables AS t JOIN dbo.Customers AS c ON 1 = 1;",
        "dbo.Customers is not a system object",
    ),
    "unqualified table": ("SELECT * FROM Customers;", "unqualified name Customers"),
    "cte name used outside its scope": (
        "SELECT (SELECT name FROM c) AS x FROM (WITH c AS (SELECT name FROM sys.tables) "
        "SELECT name FROM c) AS d;",
        "unqualified name c",
    ),
    "insert": ("INSERT INTO sys.objects (name) VALUES (N'x');", "INSERT is not allowed"),
    "update": ("UPDATE sys.objects SET name = N'x';", "UPDATE is not allowed"),
    "delete": ("DELETE FROM dbo.Customers;", "DELETE is not allowed"),
    "merge": (
        "MERGE INTO dbo.t USING sys.tables AS s ON 1 = 1 WHEN MATCHED THEN DELETE;",
        "MERGE is not allowed",
    ),
    "select into": ("SELECT name INTO dbo.copy FROM sys.tables;", "SELECT INTO is not allowed"),
    "select into temp": ("SELECT name INTO #t FROM sys.tables;", "SELECT INTO is not allowed"),
    "temp table": ("SELECT * FROM #t;", "temp table #t"),
    "global temp table": ("SELECT * FROM ##t;", "temp table"),
    "table variable": ("SELECT * FROM @t;", "table variable"),
    "variable": ("SELECT name FROM sys.tables WHERE name = @name;", "variables such as @name"),
    "exec procedure": ("EXEC dbo.usp_GetCustomers;", "EXEC is not allowed"),
    "exec string": ("EXEC('SELECT 1');", "EXEC is not allowed"),
    "sp_executesql": ("EXEC sp_executesql N'SELECT * FROM dbo.Customers';", "EXEC is not allowed"),
    "declare": ("DECLARE @x int;", "DECLARE is not allowed"),
    "openrowset": (
        "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;', 'SELECT 1') AS r;",
        "OPENROWSET reads data from outside the database",
    ),
    "openquery": (
        "SELECT * FROM OPENQUERY(remote, 'SELECT 1') AS r;",
        "OPENQUERY reads data from outside the database",
    ),
    "opendatasource": (
        "SELECT * FROM OPENDATASOURCE('SQLNCLI', 'Data Source=x').db.dbo.t;",
        "OPENDATASOURCE reads data from outside the database",
    ),
    "four-part name": (
        "SELECT * FROM remote.master.sys.tables;",
        "four-part name remote.master.sys.tables reaches a linked server",
    ),
    "three-part name": (
        "SELECT * FROM OtherDb.sys.tables;",
        "three-part name OtherDb.sys.tables reaches another database",
    ),
    "non-approved function": ("SELECT GETDATE() AS d FROM sys.tables;", "function GETDATE"),
    "user scalar function": ("SELECT dbo.fn_secret(1) AS s FROM sys.tables;", "dbo.fn_secret"),
    "user table function": ("SELECT * FROM dbo.fn_rows(1);", "table-valued function dbo.fn_rows"),
    "non-approved system table function": (
        "SELECT * FROM sys.fn_dblog(NULL, NULL);",
        "table-valued function sys.fn_dblog is not on the approved list",
    ),
    "dmv awaiting its first query": (
        "SELECT object_id, row_count FROM sys.dm_db_partition_stats;",
        "sys.dm_db_partition_stats is not on the approved list of DMVs",
    ),
    "query store view awaiting its first query": (
        "SELECT query_sql_text FROM sys.query_store_query_text;",
        "sys.query_store_query_text is not on the approved list",
    ),
    "non-approved dmv": (
        "SELECT * FROM sys.dm_exec_requests;",
        "sys.dm_exec_requests is not on the approved list of DMVs",
    ),
    "non-approved query store view": (
        "SELECT * FROM sys.query_store_wait_stats;",
        "sys.query_store_wait_stats is not on the approved list",
    ),
    "next value for writes a sequence": (
        "SELECT NEXT VALUE FOR dbo.seq AS n FROM sys.tables;",
        "function NEXT",
    ),
    "two statements": (
        "SELECT name FROM sys.tables; SELECT name FROM sys.views;",
        "exactly one statement, found 2",
    ),
    "empty file": ("-- nothing here\n", "exactly one statement, found 0"),
    "unparseable": ("SELEC name FROM sys.tables;", "cannot be parsed as T-SQL"),
    "placeholder count mismatch": (
        "-- params: a\nSELECT name FROM sys.tables WHERE name = ? AND schema_id = ?;",
        "has 2 ? placeholders but declares 1 parameters",
    ),
    "undeclared placeholder": (
        "SELECT name FROM sys.tables WHERE name = ?;",
        "has 1 ? placeholders but declares 0 parameters",
    ),
    "malformed params header": (
        "-- params: a, a\nSELECT name FROM sys.tables WHERE name = ? AND type = ?;",
        "declared twice",
    ),
    "grant": ("GRANT SELECT ON dbo.t TO someone;", "GRANT statement is not allowed"),
    "begin transaction": ("BEGIN TRANSACTION;", "statement is not allowed; only SELECT"),
    "values": ("VALUES (1);", "VALUES statement is not allowed"),
    "waitfor": ("WAITFOR DELAY '00:00:05';", "cannot be parsed as T-SQL"),
    "multi-part function": (
        "SELECT OtherDb.dbo.fn(1) AS x FROM sys.tables;",
        "uses a multi-part name",
    ),
    "named placeholder": (
        "-- params: a\nSELECT name FROM sys.tables WHERE name = :a;",
        "only positional ? placeholders",
    ),
}


def test_schema_qualified_scalar_function_needs_approval(monkeypatch: pytest.MonkeyPatch) -> None:
    sql = "SELECT sys.fn_varbintohexstr(0x01) AS h FROM sys.tables;"
    assert violations(sql) == ["function sys.fn_varbintohexstr is not on the approved list"]
    monkeypatch.setattr(
        allowlist, "APPROVED_SYSTEM_FUNCTIONS", frozenset({"sys.fn_varbintohexstr"})
    )
    assert violations(sql) == []


@pytest.mark.parametrize(("sql", "reason"), REFUSED.values(), ids=REFUSED.keys())
def test_refused_with_a_clear_reason(sql: str, reason: str) -> None:
    found = violations(sql)
    assert any(reason in problem for problem in found), found
    with pytest.raises(QueryRefusedError, match="not on the allowlist"):
        check_query(sql)

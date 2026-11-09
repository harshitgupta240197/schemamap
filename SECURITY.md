# Security Policy

Under construction. Until this is finalized, report vulnerabilities privately via GitHub Security Advisories on this repository.

## What a snapshot contains

Schema Map reads system metadata only, never table rows. A snapshot does contain:

- Object names, column types, keys, constraints, indexes and dependencies, and, with `VIEW DATABASE STATE`, approximate row counts and sizes. (Descriptions from extended properties are not extracted yet.)
- **SQL definitions** of views, procedures, functions, triggers, computed columns, defaults, check constraints and index filters. These are on by default. They are metadata, but they are free text written by developers and **may contain literals** (for example a hard-coded status value or email address). Review a snapshot before sharing it, or pass `--no-definitions` to leave all SQL text out (each definition is then marked `omitted`).
- The server host name, unless you pass `--redact-server`, which also drops linked-server names.

A snapshot never contains credentials, connection strings or query text.

On macOS and Linux a snapshot file is created readable only by you (mode 0600); share it deliberately.

## How we guarantee read-only

"Metadata only" is enforced in four layers, and each one can be checked without trusting us.

### 1. The login has no SELECT

Schema Map needs `VIEW DEFINITION` on the database, and optionally `VIEW DATABASE STATE` for row counts, sizes, Query Store and usage hints. It needs no `INSERT`, `UPDATE`, `DELETE` or `EXECUTE`, and no role such as `db_datareader`. **There is no SELECT on any user table; there is one SELECT on the system catalog view `sys.sql_expression_dependencies`, for dependency tracking** (SQL Server grants it only to `db_owner` by default). That view lists which objects refer to which; it holds no user data. With only these grants, **SQL Server itself** refuses to return a single table row, whatever a client sends. This is the layer that matters most, because the server enforces it.

```sql
CREATE LOGIN schemamap_reader WITH PASSWORD = N'<a strong password>';
USE [YourDatabase];
CREATE USER schemamap_reader FOR LOGIN schemamap_reader;
GRANT VIEW DEFINITION TO schemamap_reader;
GRANT SELECT ON sys.sql_expression_dependencies TO schemamap_reader;  -- system catalog view, for dependency tracking
GRANT VIEW DATABASE STATE TO schemamap_reader;  -- optional: row counts, sizes, Query Store and usage hints
```

Each grant beyond `VIEW DEFINITION` is optional. Without `SELECT` on the dependencies view, the dependencies section (and so impact analysis) is skipped; without `VIEW DATABASE STATE`, row counts and sizes are skipped and Query Store is reported as `unknown`. Either way the snapshot records one warning per skipped section, naming the exact `GRANT` line, and everything else is still extracted.

### 2. The connection declares read-only intent

Every connection sets `ApplicationIntent=ReadOnly`. On an Availability Group listener this routes to a readable secondary, which rejects writes. On a standalone server it is only a declaration, not enforcement, which is why it is one layer of four.

### 3. The executor runs only allowlisted files

Every SQL statement Schema Map can send is a `.sql` file in `cli/src/schemamap/queries/`. The only code in the package that touches a driver cursor is `MetadataExecutor` (`connect/executor.py`). It accepts a query *name* (an enum of those files), never SQL text, and raises `QueryRefusedError` otherwise. Before every run it parses the file again and refuses it unless it is:

- exactly one `SELECT` (CTEs and `UNION` allowed);
- over `INFORMATION_SCHEMA.*` and `sys.*` views approved one by one by exact name (not every `sys` view is metadata: `sys.sql_logins` holds password hashes and `sys.sysprocesses` shows other sessions, so neither is approved). The only DMV approved today is `sys.dm_db_partition_stats`, for row counts and sizes. System schemas must be written exactly `sys` and `INFORMATION_SCHEMA`, because in a case-sensitive database a user can create a schema named `SYS`;
- reading an unqualified name only when it is a CTE that SQL Server would resolve there (an earlier CTE, or the CTE itself for recursion), compared case-sensitively;
- calling only functions on an explicit list of built-ins (such as `SERVERPROPERTY`, `OBJECT_NAME`, `HAS_PERMS_BY_NAME`);
- free of `SELECT INTO`, temp tables, table variables, variables, `EXEC`, `sp_executesql`, `OPENROWSET`, `OPENQUERY`, `OPENDATASOURCE`, `OPENXML`, and three- or four-part names (other databases, linked servers).

Values are bound as parameters, never formatted into the SQL text.

### 4. Tests prove it on every commit

CI runs these on every push:

- `cli/tests/test_allowlist.py` parses every file in `queries/` and requires it to pass. It also feeds in queries that touch `dbo.Customers`, write, use `SELECT INTO`, temp tables, `EXEC`, `OPENROWSET`, four-part names, unapproved functions or views (`sys.sql_logins`, `sys.sysprocesses`), a `SYS` schema, a forward-referenced CTE or two statements, and requires each to fail with a clear reason.
- `cli/tests/test_static_guard.py` parses every `.py` file in the package and fails if any of them contains a SQL statement, or reaches a driver cursor or `execute` anywhere except the executor.
- `cli/tests/test_executor.py` proves the executor refuses SQL text and re-checks each file before running it.
- Against the lab's real SQL Server, `cli/tests/test_lab_integration.py` proves the reader login is denied `SELECT` on a user table in each sample database.

The unit tests run on Windows, macOS and Linux; the integration tests against SQL Server run on Linux only.

### Verify it yourself

You do not have to take our word for any of this. A DBA can check each layer directly.

**What the login can do.** Run this as an administrator in the target database. You should see `CONNECT`, `VIEW DEFINITION`, `SELECT` on `sys.sql_expression_dependencies` only, optionally `VIEW DATABASE STATE`, and no role memberships:

```sql
SELECT pe.permission_name, pe.state_desc
FROM sys.database_permissions AS pe
JOIN sys.database_principals AS pr ON pr.principal_id = pe.grantee_principal_id
WHERE pr.name = N'schemamap_reader';

SELECT r.name AS database_role
FROM sys.database_role_members AS m
JOIN sys.database_principals AS r ON r.principal_id = m.role_principal_id
JOIN sys.database_principals AS u ON u.principal_id = m.member_principal_id
WHERE u.name = N'schemamap_reader';

SELECT r.name AS server_role
FROM sys.server_role_members AS m
JOIN sys.server_principals AS r ON r.principal_id = m.role_principal_id
JOIN sys.server_principals AS l ON l.principal_id = m.member_principal_id
WHERE l.name = N'schemamap_reader';
```

Then sign in as that login and run `SELECT TOP 1 * FROM <any table>;`. It must fail with error 229, "The SELECT permission was denied". `schemamap doctor` also lists which of the three permissions the login holds.

**Every statement it can send.** Read the `.sql` files. In an installed copy they are in the folder this prints:

```
python -c "import pathlib, schemamap.queries as q; print(pathlib.Path(q.__file__).parent)"
```

**What it actually sends.** Capture its traffic with an Extended Events session, run Schema Map, then read the ring buffer:

```sql
CREATE EVENT SESSION schemamap_audit ON SERVER
ADD EVENT sqlserver.sql_batch_completed (WHERE sqlserver.server_principal_name = N'schemamap_reader'),
ADD EVENT sqlserver.rpc_completed (WHERE sqlserver.server_principal_name = N'schemamap_reader')
ADD TARGET package0.ring_buffer;
ALTER EVENT SESSION schemamap_audit ON SERVER STATE = START;
-- run schemamap, then read sys.dm_xe_session_targets for this session, then:
ALTER EVENT SESSION schemamap_audit ON SERVER STATE = STOP;
DROP EVENT SESSION schemamap_audit ON SERVER;
```

You will see each query file's text exactly as it is on disk (`sql_batch_completed`). A query with parameters arrives as `sp_prepexec` followed by `sp_unprepare`: that is how the driver binds values, and the statement inside is the file's text with `?` replaced by `@P1`, `@P2` and so on. The driver's connection pool also sends `sp_reset_connection` and `IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; SET TRANSACTION ISOLATION LEVEL READ COMMITTED` when a connection is returned. Nothing else should appear.

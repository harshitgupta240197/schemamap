# SQL Server lab

A one-command local SQL Server 2022 with the official sample databases and a read-only login. Schema Map's integration tests and demos run against it.

## Requirements

- Docker with Compose v2.
- **At least 4 GB of memory allocated to Docker** (Docker Desktop > Settings > Resources > Memory). SQL Server refuses to start, or is killed, with less. `up` warns when Docker has less and, if startup fails, the error says so.
- [uv](https://docs.astral.sh/uv/) (or any Python 3.10+; the script uses only the standard library).
- About 3 GB of free disk (the image plus about 440 MB of backups plus restored data).

## Usage

```
uv run tools/lab.py up                       # start the container, wait until it accepts logins
uv run tools/lab.py restore all              # download, verify and restore all three databases
uv run tools/lab.py restore AdventureWorks2022   # or one: AdventureWorksDW2022, WideWorldImporters
uv run tools/lab.py edgecases                # create the small SchemaMapEdgeCases database (see below)
uv run tools/lab.py status                   # container, backups, databases, reader login
uv run tools/lab.py down                     # stop and remove the container, keep the data
uv run tools/lab.py down --purge             # also wipe the SQL Server data (keeps downloaded backups)
```

On Windows use `python tools/lab.py ...` if you do not use uv.

`restore` is safe to repeat: finished downloads are reused (checked by exact size) and an existing database is replaced.

Then run the integration tests:

```
cd cli && uv run pytest -m integration
```

## What you get

| Item | Value |
| --- | --- |
| Container | `schemamap-lab`, image `mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04` (the tag CI pins, D-040), Developer edition |
| Host and port | `127.0.0.1,14330` (bound to IPv4 loopback only; use `127.0.0.1`, not `localhost`, which resolves to `::1` first on Linux) |
| Admin login | `sa` |
| Reader login | `schemamap_reader`: `VIEW DEFINITION` in each database, plus one `SELECT` on the system catalog view `sys.sql_expression_dependencies` for dependency tracking; **no SELECT on any user table** |
| Minimal login | `schemamap_reader_min`: `VIEW DEFINITION` only (no `VIEW DATABASE STATE`, no `SELECT` on `sys.sql_expression_dependencies`), same password as the reader. It exists to test that extraction degrades gracefully: row counts and dependencies are skipped with one warning each . The visibility tests (`test_extract_visibility_integration.py`) revoke its `VIEW DEFINITION` on `SchemaMapEdgeCases` to prove `extract` exits 3 and writes no file, and put it back with `lab.py grant SchemaMapEdgeCases`; they also create and drop two throwaway databases (`SchemaMapVisibilityOwner`, `SchemaMapVisibilityEmpty`) and one lab-only login. If a run is killed half way, `uv run tools/lab.py grant SchemaMapEdgeCases` restores the grant |
| Databases | `AdventureWorks2022`, `AdventureWorksDW2022`, `WideWorldImporters`; plus `SchemaMapEdgeCases` and `SchemaMapSynth*` when you build them (below) |
| Data | `lab-data/mssql/` (SQL Server files) and `lab-data/backups/` (downloads), both gitignored |

The reader login is what Schema Map should connect as. It can read catalog metadata (`sys.tables`, ...) and cannot read a single row of any user table, which is the access level real users are asked to grant.

Add `--view-database-state` to `restore` (or to `grant`, below) to also give `schemamap_reader` `VIEW DATABASE STATE`, which row counts and sizes, Query Store views and some DMVs need (`schemamap_reader_min` never gets it):

```
uv run tools/lab.py restore all --view-database-state
uv run tools/lab.py grant AdventureWorks2022                       # re-apply both logins, flag off
uv run tools/lab.py grant AdventureWorks2022 --view-database-state # re-apply both logins, flag on
```

## Edge cases database

```
uv run tools/lab.py edgecases
```

Creates `SchemaMapEdgeCases` (and a tiny `SchemaMapEdgeCasesOther` for cross-database references) as `sa`, replacing them if they exist, and grants the reader `VIEW DEFINITION`. The sample databases are never touched. It holds the awkward shapes the sample databases lack:

| Object | Why |
| --- | --- |
| `dbo.SecretProc` | encrypted procedure: no definition, status `encrypted` |
| `dbo.FK_Child_Parent_A`, `dbo.FK_Child_Parent_B` | two foreign keys on identical columns: one edge, two constraints |
| `dbo.RemoteView`, `dbo.RemoteSynonym` | refer to `SchemaMapEdgeCasesOther`: cross-database, never resolved |
| `dbo.RemoteFnView` | calls `SchemaMapEdgeCasesOther.dbo.RemoteFn(...)`: a genuine cross-database reference that looks like a method call |
| `dbo.XmlDoc`, `dbo.XmlMethodView`, `dbo.XmlAliasLikeDatabaseView` | `Body.value(...)` on an XML column, also through an alias named like a real database: `column_method`, never `cross_database` |
| `dbo.UsesMissing` | refers to `dbo.DoesNotExist`: an unresolved local reference |
| `dbo.IX_Child_Active` (on `dbo.Child`) | filtered index |
| `dbo.Versioned`, `dbo.VersionedHistory` | system-versioned temporal table and its history table |
| `dbo.[Odd.Table [x] Ü☃]` | a name with a dot, brackets and non-ASCII characters |

The integration tests for crumb 1.5 expect it, and fail with this command in the message if it is missing.

## Synthetic databases

```
uv run tools/lab.py synth --tables 2000 --seed 1                 # builds SchemaMapSynth
uv run tools/lab.py synth --tables 200 --name SchemaMapSynth200  # name must start with SchemaMapSynth
uv run tools/synth.py --tables 500 --out some/folder             # files only, no database
```

Builds a messy database with known answers for speed tests and inference measurement, and writes `<name>.sql` and `<name>.truth.json` to `lab-data/synth/`. The ground truth lists every true relationship (declared or not), the traps that are not relationships, and what the generated views and procedures join. Reference: 2,000 tables build in about 6 s and extract in about 11 s. See D-037.

## Passwords

`up` generates a random 24-character password for `sa` and for `schemamap_reader` and saves them to `.env` (mode 0600, gitignored; `.env.example` shows the shape). Nothing prints them. Existing values are never overwritten. To use a login by hand, read the value from `.env` yourself.

If you delete `.env` after the first start, the data folder still holds the old `sa` password and `up` will time out. Run `uv run tools/lab.py down --purge`, then `up` again.

## CI mode

CI (the `integration` job in `.github/workflows/ci.yml`) runs the same commands with no `.env`. When `.env` is absent and both `SCHEMAMAP_LAB_SA_PASSWORD` and `SCHEMAMAP_LAB_READER_PASSWORD` are set in the environment, `lab.py` uses them and writes nothing to disk; a `.env` file always wins. The reader password must be letters and digits only. `SCHEMAMAP_LAB_IMAGE_TAG` selects the SQL Server image tag. CI pins a specific cumulative update (D-038) and `docker-compose.yml` defaults to the same tag (D-040), so local and CI runs use one build. To move an existing lab onto the pinned tag, run `down` then `up`: the new image is pulled and `lab-data/` is kept. The job generates both passwords at start, masks them with `::add-mask::` and passes them to later steps through the environment.

## Port 14330

The lab uses host port 14330, not SQL Server's default 1433, because 1433 is often taken by another container or a local instance. Inside the container SQL Server still listens on 1433. To change the host port, edit `docker-compose.yml` and `HOST_PORT` in `tools/lab.py`.

## Apple Silicon

SQL Server 2022 for Linux is published for amd64 only. `docker-compose.yml` pins `platform: linux/amd64`, so Docker Desktop runs it under emulation. It works, but the first start is slower and the image pull is about 2.3 GB. If SQL Server crashes at startup, raise Docker's memory limit first. Enabling "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" in Docker Desktop settings generally helps speed.

## Where the backups come from

`restore` downloads these official backups from the `microsoft/sql-server-samples` GitHub releases and checks each file's exact byte size before using it:

- `AdventureWorks2022.bak` and `AdventureWorksDW2022.bak` from the `adventureworks` release
- `WideWorldImporters-Full.bak` from the `wide-world-importers-v1.0` release

Downloads are built for flaky networks (for example where GitHub release downloads return 504):

- A 5xx answer or a dropped connection is retried up to 3 times with exponential backoff (2 s, then 4 s).
- Bytes received so far are kept in `<file>.part` and the next attempt, or the next `restore` run, continues with an HTTP Range request. The file is renamed to its final name only after its size matches exactly.
- If the direct URL still fails, the lab asks the GitHub API (`api.github.com`, `releases/tags/<tag>`) for the asset and downloads it from the asset endpoint. No login is needed; if `GITHUB_TOKEN` is set it is sent to `api.github.com` only (never to the file host it redirects to) and is never printed. Set it if you hit the unauthenticated API rate limit.
- A file of the wrong size is rejected and its `.part` file deleted. A file that is already present with the right size is not downloaded again.
- If every route fails, the error names the file and says what to do: download it in a browser, save it in `lab-data/backups/` under the same name, and run `uv run tools/lab.py restore` again. It is picked up as is.

## Optional extra: the Stack Overflow database

A large real-world database is useful for stress-testing layout and speed. It is not downloaded or managed by the lab, and this procedure has not been scripted or tested here:

1. Download a Stack Overflow database from its publisher (Brent Ozar publishes ready-to-use copies in several sizes; check the site for current links, sizes and licence terms). Use only public data.
2. If it ships as a `.bak`, put it in `lab-data/backups/`, which the container sees as `/backups`, and restore it with `RESTORE DATABASE` as `sa` (for example through `docker exec -it schemamap-lab /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C`, which prompts for the password). Move the data files under `/var/opt/mssql/data`.
3. Give the reader its access: `uv run tools/lab.py grant <DatabaseName>`.

It needs far more disk and time than the three built-in databases, so keep it out of CI.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `up` times out or the container exits | Docker memory under 4 GB, or a stale `sa` password (see Passwords). |
| `bind: address already in use` | Something else uses 14330. Stop it or change the port. |
| `Docker is installed but not running` | Start Docker Desktop. |
| `restore` says the lab is not running | Run `up` first. |
| Integration tests fail with "Lab not initialised" | Run `up` and `restore all`. |

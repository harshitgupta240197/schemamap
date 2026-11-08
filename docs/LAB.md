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
| Container | `schemamap-lab`, image `mcr.microsoft.com/mssql/server:2022-latest`, Developer edition |
| Host and port | `localhost,14330` (bound to loopback only) |
| Admin login | `sa` |
| Reader login | `schemamap_reader`: `VIEW DEFINITION` in each database, **no SELECT** |
| Databases | `AdventureWorks2022`, `AdventureWorksDW2022`, `WideWorldImporters` |
| Data | `lab-data/mssql/` (SQL Server files) and `lab-data/backups/` (downloads), both gitignored |

The reader login is what Schema Map should connect as. It can read catalog metadata (`sys.tables`, ...) and cannot read a single row of any user table, which is the access level real users are asked to grant.

Add `--view-database-state` to `restore` (or to `grant`, below) to also give the reader `VIEW DATABASE STATE`, which Query Store views and some DMVs need:

```
uv run tools/lab.py restore all --view-database-state
uv run tools/lab.py grant AdventureWorks2022                       # re-apply, flag off
uv run tools/lab.py grant AdventureWorks2022 --view-database-state # re-apply, flag on
```

## Passwords

`up` generates a random 24-character password for `sa` and for `schemamap_reader` and saves them to `.env` (mode 0600, gitignored; `.env.example` shows the shape). Nothing prints them. Existing values are never overwritten. To use a login by hand, read the value from `.env` yourself.

If you delete `.env` after the first start, the data folder still holds the old `sa` password and `up` will time out. Run `uv run tools/lab.py down --purge`, then `up` again.

## Port 14330

The lab uses host port 14330, not SQL Server's default 1433, because 1433 is often taken by another container or a local instance. Inside the container SQL Server still listens on 1433. To change the host port, edit `docker-compose.yml` and `HOST_PORT` in `tools/lab.py`.

## Apple Silicon

SQL Server 2022 for Linux is published for amd64 only. `docker-compose.yml` pins `platform: linux/amd64`, so Docker Desktop runs it under emulation. It works, but the first start is slower and the image pull is about 2.3 GB. If SQL Server crashes at startup, raise Docker's memory limit first. Enabling "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" in Docker Desktop settings generally helps speed.

## Where the backups come from

`restore` downloads these official backups from the `microsoft/sql-server-samples` GitHub releases and checks each file's exact byte size before using it:

- `AdventureWorks2022.bak` and `AdventureWorksDW2022.bak` from the `adventureworks` release
- `WideWorldImporters-Full.bak` from the `wide-world-importers-v1.0` release

If a download fails or the size is wrong, the partial file is deleted and the command stops with an error. You can also place the file in `lab-data/backups/` yourself.

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

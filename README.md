# schemamap

Map a SQL Server database's schema into an offline, single-file HTML viewer, using metadata only.

Schema Map signs in with a read-only login, reads only system catalog views (never your rows),
and writes one `.html` file you can open anywhere, with no server and no network. It runs on
Windows, macOS and Linux.

> Pre-release. Until `v0.1.0` is on PyPI, install from a checkout (below).

## Install

You need Python 3.10 or later and [uv](https://docs.astral.sh/uv/).

```
git clone <this repository>
cd schemamap/cli
uv sync
```

The launcher and map viewer are built pages that are packaged into the command. From a checkout,
build them once (needs Node.js 24): `cd viewer && npm ci && npm run build`, then from the repo
root: `uv run tools/build_viewer.py`.
A released wheel already contains them.

## Quickstart: the launcher

```
uv run schemamap ui
```

Your browser opens at a page served from your own computer (`127.0.0.1`). Then:

1. **Connect.** Enter the server and a read-only login. Passwords are never saved or logged.
2. **Check.** Schema Map tests the connection and tells you in plain English what is missing,
   with a script to hand to your DBA.
3. **Choose a database,** then **Extract.** Only system metadata is read.
4. **Open map.** The map opens in a new tab. It is saved under `SchemaMap` in your home folder,
   with your recent maps.

Close the tab and press Ctrl+C in the terminal when you are done. A picture of each screen and
the details are in [docs/UI.md](docs/UI.md#using-the-launcher).

## Quickstart: the command line

For scripts, or when you cannot open a browser on the machine:

```
uv run schemamap doctor  --server localhost --database AdventureWorks2022
uv run schemamap extract --server localhost --database AdventureWorks2022
uv run schemamap view AdventureWorks2022.snapshot.json
```

`extract` asks for the login in a hidden prompt (or reads `SCHEMAMAP_USER` and
`SCHEMAMAP_PASSWORD`) and writes a snapshot file; `view` turns it into the offline map and opens
it. `schemamap --help` lists every option.

## What it never does

- It reads `sys.*` catalog views, `INFORMATION_SCHEMA` and Query Store views: never a user table.
- It changes nothing on the server: no writes, no temporary objects.
- It makes no network calls. Snapshots and maps stay on your machine.

## Working on it

See [CLAUDE.md](CLAUDE.md) for the repo map and the checks to run, and [docs/](docs/) for the
architecture, decisions and the SQL Server lab used for testing.

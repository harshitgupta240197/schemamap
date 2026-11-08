# Security Policy

Under construction. Until this is finalized, report vulnerabilities privately via GitHub Security Advisories on this repository.

## What a snapshot contains

Schema Map reads system metadata only, never table rows. A snapshot does contain:

- Object names, column types, keys, indexes and descriptions (extended properties).
- **SQL definitions** of views, procedures, functions, triggers, computed columns, defaults, check constraints and index filters. These are on by default. They are metadata, but they are free text written by developers and **may contain literals** (for example a hard-coded status value or email address). Review a snapshot before sharing it. A `--no-definitions` flag to omit them is planned.
- The server host name, unless you pass `--redact-server`, which also drops linked-server names.

A snapshot never contains credentials, connection strings or query text.

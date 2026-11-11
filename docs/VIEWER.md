# Viewer

## URL hash format

The viewer mirrors what you are looking at into the location hash, so a link reopens the same view in the same map file. The hash is written with `history.replaceState` (no extra history entries) and read when the page opens and on every `hashchange`.

```
#focus=<table id>&focus=<table id>&hops=2&schema=<schema id>&cluster=<cluster id>&group=<small group id>&drill=<schema id>&select=<object id>
```

An empty hash is the default view with nothing selected (see [Default view](#default-view)). Keys can appear in any order when read; the viewer writes them in the order below.

| Key | Repeats | Value | Meaning |
| --- | --- | --- | --- |
| `focus` | yes | id of a **table** | Tables in focus. Empty means the full map. |
| `hops` | no | `1`, `2` or `3` | How many relationships around the focused tables to include. Default `1`. |
| `schema` | yes | id of a **schema** | Show only these schemas. Empty means every schema. |
| `cluster` | no | id of an **overview cluster** | The cluster drilled into from the overview. Ignored while `focus` is set except as the breadcrumb's way back. |
| `group` | no | id of a **small group** | The small group drilled into from a schema's boxes: the tables of that schema's clusters of 3 tables or fewer. Ignored while `focus` is set except as the breadcrumb's way back. |
| `drill` | no | id of a **schema** | The schema drilled into from the schema overview. Ignored while `focus` is set except as the breadcrumb's way back. |
| `select` | no | id of a **table, view or routine** | The object open in the detail panel. |

Ids are the snapshot's own ids, for example `object:Sales.Orders` or `schema:Sales`. A cluster id is `cluster:` followed by the smallest table id in the cluster, for example `cluster:object:Sales.Customers`; a small group id is `group:` followed by the smallest table id in the group. Clusters and small groups are computed from the snapshot when it opens, so their ids are only known while that table still leads them.

### Default view

What the canvas shows, first rule that applies:

1. `focus` set: the focused tables and their neighbours within `hops`.
2. `cluster` set: that cluster's tables.
3. `group` set: that small group's tables.
4. `drill` set: that schema's tables when they number **200 or fewer**, else the schema's boxes (below).
5. The tables in view (every table, or the `schema` filter's) number **200 or fewer**: the full map.
6. Otherwise, with more than one schema in view: the **overview**, one box per schema, showing its table count and its larger clusters.
7. Otherwise (one schema in view): that schema's boxes.

A schema's boxes are one box per cluster of more than 3 tables and one **small groups** box for its clusters of 3 tables or fewer (when it has at least two of them; a group past 200 tables is split). Clusters group tables by schema, then by foreign-key-connected component within the schema; a schema's tables with no key to another table of that schema share one cluster, and anything over 200 tables is split. The limit and the rules are in `docs/DECISIONS.md` (D-047, D-053). A `hops` value whose view would pass 200 tables is lowered to the most that fits (1 is always allowed).

### Encoding

- The hash is `&`-separated `key=value` pairs. A leading `#` is optional when reading.
- Values are percent-encoded with `encodeURIComponent` and decoded with `decodeURIComponent`. A table named `a&b` therefore appears as `object:dbo.a%26b`. Names are treated as untrusted text: a value is only ever compared with the ids in the loaded snapshot, never rendered as HTML or evaluated.

### Canonical form

When writing, the viewer sorts and de-duplicates `focus` and `schema` ids, so equal views produce equal hashes. `hops` is written only when at least one table is in focus and it is not the default `1`. At most one of `cluster`, `group` and `drill` is kept: `cluster` wins over `group`, which wins over `drill`.

### What is ignored

A stale, hand-edited or hostile hash can only give a smaller view, never an error. Each of these is dropped silently, and the rest of the hash still applies:

- a pair without `=`, or with a key the viewer does not know
- a value that is not valid percent-encoding
- an id that is not in the loaded snapshot, or that is the wrong kind for its key (a view or schema under `focus`, a table under `schema` or `drill`, a schema under `select`, anything but a current cluster id under `cluster` or a current small group id under `group`)
- `hops` other than a single digit `1`, `2` or `3` (`0`, `4`, `02`, `1.5`, empty)
- repeated `hops`, `cluster`, `group`, `drill` or `select`: the last valid one wins
- a `group` or `drill` beside a `cluster`, or a `drill` beside a `group` (see Canonical form)

Because ids are looked up per snapshot, a link made from one database means nothing in another map: every id is unknown there, so it opens as the full map.

### Compatibility promise (format v1)

- Keys are only ever **added**. An existing key is never removed, renamed or given a different meaning.
- A new key never changes how a hash that does not use it is read.
- Older viewers ignore keys they do not know, so a link using a newer key still opens in an older viewer, showing the part it understands.
- Links written by any v1 viewer open in any later v1 viewer.
- One deliberate exception, made before any v1 viewer shipped: on a snapshot of more than 200 tables, a hash with no `focus` and no `cluster` whose tables number more than 200 opens the overview instead of the full map (D-047).
- The overview itself became one box per schema in crumb 2.10, before any v1 viewer shipped (D-053). No key changed meaning: `cluster` links open the same cluster, and `group` and `drill` are new keys.

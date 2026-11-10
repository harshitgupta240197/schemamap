# Viewer

## URL hash format

The viewer mirrors what you are looking at into the location hash, so a link reopens the same view in the same map file. The hash is written with `history.replaceState` (no extra history entries) and read when the page opens and on every `hashchange`.

```
#focus=<table id>&focus=<table id>&hops=2&schema=<schema id>&select=<object id>
```

An empty hash is the full map with nothing selected. Keys can appear in any order when read; the viewer writes them in the order below.

| Key | Repeats | Value | Meaning |
| --- | --- | --- | --- |
| `focus` | yes | id of a **table** | Tables in focus. Empty means the full map. |
| `hops` | no | `1`, `2` or `3` | How many relationships around the focused tables to include. Default `1`. |
| `schema` | yes | id of a **schema** | Show only these schemas. Empty means every schema. |
| `select` | no | id of a **table, view or routine** | The object open in the detail panel. |

Ids are the snapshot's own ids, for example `object:Sales.Orders` or `schema:Sales`.

### Encoding

- The hash is `&`-separated `key=value` pairs. A leading `#` is optional when reading.
- Values are percent-encoded with `encodeURIComponent` and decoded with `decodeURIComponent`. A table named `a&b` therefore appears as `object:dbo.a%26b`. Names are treated as untrusted text: a value is only ever compared with the ids in the loaded snapshot, never rendered as HTML or evaluated.

### Canonical form

When writing, the viewer sorts and de-duplicates `focus` and `schema` ids, so equal views produce equal hashes. `hops` is written only when at least one table is in focus and it is not the default `1`.

### What is ignored

A stale, hand-edited or hostile hash can only give a smaller view, never an error. Each of these is dropped silently, and the rest of the hash still applies:

- a pair without `=`, or with a key the viewer does not know
- a value that is not valid percent-encoding
- an id that is not in the loaded snapshot, or that is the wrong kind for its key (a view or schema under `focus`, a table under `schema`, a schema under `select`)
- `hops` other than a single digit `1`, `2` or `3` (`0`, `4`, `02`, `1.5`, empty)
- repeated `hops` or `select`: the last valid one wins

Because ids are looked up per snapshot, a link made from one database means nothing in another map: every id is unknown there, so it opens as the full map.

### Compatibility promise (format v1)

- Keys are only ever **added**. An existing key is never removed, renamed or given a different meaning.
- A new key never changes how a hash that does not use it is read.
- Older viewers ignore keys they do not know, so a link using a newer key still opens in an older viewer, showing the part it understands.
- Links written by any v1 viewer open in any later v1 viewer.

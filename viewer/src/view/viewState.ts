import type { SnapshotIndexes } from "../snapshot/indexes";

export type Hops = 1 | 2 | 3;

/** What the person is looking at: the focused tables, how far around them, and a schema filter. */
export interface ViewState {
  /** Table ids in focus; empty is the full map. Sorted. */
  readonly focus: readonly string[];
  readonly hops: Hops;
  /** Schema ids to show; empty is every schema. Sorted. */
  readonly schemas: readonly string[];
  /** Id of the table, view or routine open in the detail panel, or `null` for none. */
  readonly selected: string | null;
}

export const DEFAULT_HOPS: Hops = 1;
export const FULL_MAP: ViewState = { focus: [], hops: DEFAULT_HOPS, schemas: [], selected: null };

function sorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/** A view state with its lists sorted and de-duplicated, so equal views serialize equally. */
export function makeViewState(
  focus: Iterable<string>,
  hops: Hops,
  schemas: Iterable<string>,
  selected: string | null = null,
): ViewState {
  return { focus: sorted(focus), hops, schemas: sorted(schemas), selected };
}

function isSelectable(kind: string | undefined): boolean {
  return kind === "table" || kind === "view" || kind === "routine";
}

function isHops(value: number): value is Hops {
  return value === 1 || value === 2 || value === 3;
}

function decode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Read a view from a location hash (`#focus=<id>&hops=2&schema=<id>&select=<id>`). Anything that is not a
 * known id or a hop count of 1 to 3 is dropped without complaint: a stale, hand-edited or hostile
 * hash can only ever give a smaller view, never an error. Values are only compared with ids.
 */
export function parseHash(hash: string, indexes: SnapshotIndexes): ViewState {
  const focus: string[] = [];
  const schemas: string[] = [];
  let hops: Hops = DEFAULT_HOPS;
  let selected: string | null = null;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of body.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = part.slice(0, eq);
    const value = decode(part.slice(eq + 1));
    if (value === null) {
      continue;
    }
    if (key === "focus" && indexes.byId(value)?.kind === "table") {
      focus.push(value);
    } else if (key === "schema" && indexes.byId(value)?.kind === "schema") {
      schemas.push(value);
    } else if (key === "select" && isSelectable(indexes.byId(value)?.kind)) {
      selected = value;
    } else if (key === "hops" && /^[0-9]$/.test(value) && isHops(Number(value))) {
      hops = Number(value) as Hops;
    }
  }
  return makeViewState(focus, hops, schemas, selected);
}

/** The location hash for a view; empty for the default full map. Ids go through encodeURIComponent. */
export function formatHash(state: ViewState): string {
  const parts: string[] = [];
  for (const id of state.focus) {
    parts.push(`focus=${encodeURIComponent(id)}`);
  }
  if (state.focus.length > 0 && state.hops !== DEFAULT_HOPS) {
    parts.push(`hops=${String(state.hops)}`);
  }
  for (const id of state.schemas) {
    parts.push(`schema=${encodeURIComponent(id)}`);
  }
  if (state.selected !== null) {
    parts.push(`select=${encodeURIComponent(state.selected)}`);
  }
  return parts.length === 0 ? "" : `#${parts.join("&")}`;
}

export function sameView(a: ViewState, b: ViewState): boolean {
  return formatHash(a) === formatHash(b);
}

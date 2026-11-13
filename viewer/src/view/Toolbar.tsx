import { useEffect, useRef } from "react";
import { ThemeSwitch } from "../shared/ThemeSwitch";
import { LAYOUT_LIMIT } from "../graph/layout";
import type { SnapshotIndexes } from "../snapshot/indexes";
import type { Clustering } from "./clusters";
import {
  backToCluster,
  backToRoot,
  backToSchema,
  focusOn,
  levelSchema,
  rootLevel,
  withSchemas,
  type Level,
} from "./level";
import type { Folding } from "./schemaGroups";
import { withHops, type Hops, type ViewState } from "./viewState";
import "./toolbar.css";

interface ToolbarProps {
  readonly indexes: SnapshotIndexes;
  readonly clustering: Clustering;
  readonly folding: Folding;
  readonly level: Level;
  /** Most hops the current focus allows within the layout limit. */
  readonly maxHops: Hops;
  readonly state: ViewState;
  readonly onChange: (next: ViewState) => void;
  readonly onSearch: () => void;
  /** Number of tables on the map now, and in the whole snapshot. */
  readonly shown: number;
  readonly total: number;
}

const HOPS: readonly Hops[] = [1, 2, 3];

function focusLabel(indexes: SnapshotIndexes, focus: readonly string[]): string {
  const only = focus.length === 1 ? indexes.byId(focus[0] ?? "") : undefined;
  if (only?.kind === "table") {
    return `${only.schemaName}.${only.item.name}`;
  }
  return `${String(focus.length)} tables`;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function countLine(
  level: Level,
  folding: Folding,
  schemas: ReadonlySet<string>,
  schema: string | null,
  shown: number,
  total: number,
): string {
  if (level === "schema") {
    const group = schema === null ? undefined : folding.schemaById.get(schema);
    return `${plural(group?.tableCount ?? 0, "table", "tables")} in ${plural(group?.clusterCount ?? 0, "cluster", "clusters")}`;
  }
  if (level !== "overview") {
    return `${String(shown)} of ${String(total)} tables`;
  }
  const inView = folding.schemas.filter((s) => schemas.size === 0 || schemas.has(s.schemaId));
  const tables = inView.reduce((sum, s) => sum + s.tableCount, 0);
  return `${plural(tables, "table", "tables")} in ${plural(inView.length, "schema", "schemas")}`;
}

interface Crumb {
  readonly key: string;
  readonly label: string;
  readonly to: ViewState;
}

/**
 * Search button, schema filter, hop control, Focus button, and the breadcrumb: the overview or
 * full map, then the schema drilled into, then the cluster or small group, then the focus. Each
 * earlier crumb leads back.
 */
export function Toolbar({
  indexes,
  clustering,
  folding,
  level,
  maxHops,
  state,
  onChange,
  onSearch,
  shown,
  total,
}: ToolbarProps) {
  const schemas = (indexes.snapshot.schemas ?? []).filter((schema) =>
    (indexes.snapshot.tables ?? []).some((table) => table.schema_id === schema.id),
  );
  const selected = new Set(state.schemas);
  const inFocus = state.focus.length > 0;
  const root = backToRoot(state);
  const rootIs = rootLevel(indexes, state);
  const cluster = state.cluster === null ? undefined : clustering.byId.get(state.cluster);
  const group = state.group === null ? undefined : folding.groups.get(state.group);
  // The schema crumb leads to the schema's own level when the root is the schema overview.
  const schemaId =
    state.drill ?? (rootIs === "overview" ? (cluster?.schemaId ?? group?.schemaId ?? null) : null);
  const schema = schemaId === null ? undefined : folding.schemaById.get(schemaId);
  const crumbs: Crumb[] = [
    {
      key: "root",
      label: rootIs === "overview" || rootIs === "schema" ? "Overview" : "Full map",
      to: root,
    },
  ];
  if (schema !== undefined) {
    crumbs.push({
      key: "schema",
      label: schema.schemaName,
      to: backToSchema(state, schema.schemaId),
    });
  }
  const place = cluster?.name ?? group?.name;
  if (place !== undefined) {
    crumbs.push({ key: "place", label: place, to: backToCluster(state) });
  }
  const chosen = state.selected === null ? undefined : indexes.byId(state.selected);
  const focusable =
    chosen?.kind === "table" && !(state.focus.length === 1 && state.focus[0] === chosen.id)
      ? chosen
      : undefined;

  // Clicking a crumb replaces it with plain text, which would drop focus to the page. The
  // current crumb takes focus instead, once the new view has rendered.
  const current = useRef<HTMLSpanElement>(null);
  const crumbClicked = useRef(false);
  useEffect(() => {
    if (crumbClicked.current) {
      crumbClicked.current = false;
      current.current?.focus();
    }
  }, [state]);
  const goTo = (next: ViewState): void => {
    crumbClicked.current = true;
    onChange(next);
  };

  const toggleSchema = (id: string): void => {
    const next = new Set(selected);
    if (!next.delete(id)) {
      next.add(id);
    }
    onChange(withSchemas(state, next));
  };

  return (
    <div className="sm-toolbar">
      <button type="button" className="sm-toolbar__button" onClick={onSearch}>
        Search <kbd>/</kbd>
      </button>
      <details className="sm-toolbar__schemas">
        <summary>
          Schemas
          {selected.size > 0 ? ` (${String(selected.size)} of ${String(schemas.length)})` : ""}
        </summary>
        <fieldset className="sm-toolbar__menu">
          <legend className="sm-visually-hidden">Show only these schemas</legend>
          {schemas.map((schema) => (
            <label key={schema.id} className="sm-toolbar__check">
              <input
                type="checkbox"
                checked={selected.has(schema.id)}
                onChange={() => {
                  toggleSchema(schema.id);
                }}
              />
              <span>{schema.name}</span>
            </label>
          ))}
          {selected.size > 0 ? (
            <button
              type="button"
              className="sm-toolbar__button"
              onClick={() => {
                onChange(withSchemas(state, []));
              }}
            >
              All schemas
            </button>
          ) : null}
        </fieldset>
      </details>
      {inFocus ? (
        <div className="sm-toolbar__hops" role="group" aria-label="Hops from the focused table">
          <span>Hops</span>
          {HOPS.map((hops) => (
            <button
              key={hops}
              type="button"
              className="sm-toolbar__button"
              aria-pressed={state.hops === hops}
              disabled={hops > maxHops}
              title={
                hops > maxHops
                  ? `${String(hops)} hops would show more than ${String(LAYOUT_LIMIT)} tables`
                  : undefined
              }
              onClick={() => {
                onChange(withHops(state, hops));
              }}
            >
              {hops}
            </button>
          ))}
        </div>
      ) : null}
      {focusable === undefined ? null : (
        <button
          type="button"
          className="sm-toolbar__button"
          aria-label={`Focus on ${focusable.schemaName}.${focusable.item.name}`}
          onClick={() => {
            onChange(focusOn(state, focusable.id));
          }}
        >
          Focus
        </button>
      )}
      <nav className="sm-toolbar__crumbs" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((crumb, i) => (
            <li key={crumb.key}>
              {inFocus || i < crumbs.length - 1 ? (
                <button
                  type="button"
                  className="sm-toolbar__link"
                  onClick={() => {
                    goTo(crumb.to);
                  }}
                >
                  {crumb.label}
                </button>
              ) : (
                <span ref={current} tabIndex={-1} aria-current="page">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
          {inFocus ? (
            <li>
              <span aria-current="page">{focusLabel(indexes, state.focus)}</span>
            </li>
          ) : null}
        </ol>
      </nav>
      <span className="sm-toolbar__count" role="status">
        {countLine(level, folding, selected, levelSchema(indexes, state), shown, total)}
      </span>
      <ThemeSwitch />
    </div>
  );
}

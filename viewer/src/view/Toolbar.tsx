import { useEffect, useRef } from "react";
import { LAYOUT_LIMIT } from "../graph/layout";
import type { SnapshotIndexes } from "../snapshot/indexes";
import type { Clustering } from "./clusters";
import {
  backToCluster,
  backToRoot,
  focusOn,
  rootTableCount,
  viewLevel,
  withSchemas,
  type Level,
} from "./level";
import { makeViewState, type Hops, type ViewState } from "./viewState";
import "./toolbar.css";

interface ToolbarProps {
  readonly indexes: SnapshotIndexes;
  readonly clustering: Clustering;
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

function countLine(
  level: Level,
  clustering: Clustering,
  schemas: ReadonlySet<string>,
  shown: number,
  total: number,
): string {
  if (level !== "overview") {
    return `${String(shown)} of ${String(total)} tables`;
  }
  const clusters = clustering.clusters.filter(
    (cluster) => schemas.size === 0 || schemas.has(cluster.schemaId),
  );
  const tables = clusters.reduce((sum, cluster) => sum + cluster.tableIds.length, 0);
  return `${String(tables)} tables in ${String(clusters.length)} clusters`;
}

/**
 * Search button, schema filter, hop control, Focus button, and the breadcrumb: the overview or
 * full map, then the cluster drilled into, then the focus. Each earlier crumb leads back.
 */
export function Toolbar({
  indexes,
  clustering,
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
  const rootLabel =
    viewLevel(root, rootTableCount(indexes, state.schemas)) === "overview"
      ? "Overview"
      : "Full map";
  const cluster = state.cluster === null ? undefined : clustering.byId.get(state.cluster);
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
                onChange(
                  makeViewState(state.focus, hops, state.schemas, state.selected, state.cluster),
                );
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
          <li>
            {inFocus || cluster !== undefined ? (
              <button
                type="button"
                className="sm-toolbar__link"
                onClick={() => {
                  goTo(root);
                }}
              >
                {rootLabel}
              </button>
            ) : (
              <span ref={current} tabIndex={-1} aria-current="page">
                {rootLabel}
              </span>
            )}
          </li>
          {cluster === undefined ? null : (
            <li>
              {inFocus ? (
                <button
                  type="button"
                  className="sm-toolbar__link"
                  onClick={() => {
                    goTo(backToCluster(state));
                  }}
                >
                  {cluster.name}
                </button>
              ) : (
                <span ref={current} tabIndex={-1} aria-current="page">
                  {cluster.name}
                </span>
              )}
            </li>
          )}
          {inFocus ? (
            <li>
              <span aria-current="page">{focusLabel(indexes, state.focus)}</span>
            </li>
          ) : null}
        </ol>
      </nav>
      <span className="sm-toolbar__count" role="status">
        {countLine(level, clustering, selected, shown, total)}
      </span>
    </div>
  );
}

import type { SnapshotIndexes } from "../snapshot/indexes";
import { makeViewState, type Hops, type ViewState } from "./viewState";
import "./toolbar.css";

interface ToolbarProps {
  readonly indexes: SnapshotIndexes;
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

/** Search button, schema filter, hop control and the breadcrumb back to the full map. */
export function Toolbar({ indexes, state, onChange, onSearch, shown, total }: ToolbarProps) {
  const schemas = (indexes.snapshot.schemas ?? []).filter((schema) =>
    (indexes.snapshot.tables ?? []).some((table) => table.schema_id === schema.id),
  );
  const selected = new Set(state.schemas);
  const inFocus = state.focus.length > 0;

  const toggleSchema = (id: string): void => {
    const next = new Set(selected);
    if (!next.delete(id)) {
      next.add(id);
    }
    onChange(makeViewState(state.focus, state.hops, next));
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
                onChange(makeViewState(state.focus, state.hops, []));
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
              onClick={() => {
                onChange(makeViewState(state.focus, hops, state.schemas));
              }}
            >
              {hops}
            </button>
          ))}
        </div>
      ) : null}
      <nav className="sm-toolbar__crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            {inFocus ? (
              <button
                type="button"
                className="sm-toolbar__link"
                onClick={() => {
                  onChange(makeViewState([], state.hops, state.schemas));
                }}
              >
                Full map
              </button>
            ) : (
              <span aria-current="page">Full map</span>
            )}
          </li>
          {inFocus ? (
            <li>
              <span aria-current="page">{focusLabel(indexes, state.focus)}</span>
            </li>
          ) : null}
        </ol>
      </nav>
      <span className="sm-toolbar__count" role="status">
        {String(shown)} of {String(total)} tables
      </span>
    </div>
  );
}

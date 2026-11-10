import "./app.css";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { SchemaMapSnapshotV1 } from "./generated/snapshot";
import { GraphCanvas } from "./graph/GraphCanvas";
import { SnapshotLoadError } from "./snapshot/errors";
import { buildIndexes } from "./snapshot/indexes";
import { loadSnapshotFile, readInlineSnapshot } from "./snapshot/load";
import { Palette, useSearchShortcut } from "./search/Palette";
import { buildSearchItems, type SearchItem } from "./search/searchIndex";
import { focusTargets, visibleTables } from "./view/focus";
import { Toolbar } from "./view/Toolbar";
import { formatHash, parseHash, sameView, makeViewState, type ViewState } from "./view/viewState";

type LoadState =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; snapshot: SchemaMapSnapshotV1 };

function describe(error: unknown): string {
  return error instanceof SnapshotLoadError ? error.message : "The snapshot could not be read.";
}

function initialState(): LoadState {
  try {
    const snapshot = readInlineSnapshot();
    return snapshot === null ? { kind: "empty" } : { kind: "loaded", snapshot };
  } catch (error) {
    return { kind: "error", message: describe(error) };
  }
}

function Loaded({ snapshot }: { snapshot: SchemaMapSnapshotV1 }) {
  const indexes = useMemo(() => buildIndexes(snapshot), [snapshot]);
  const items = useMemo(() => buildSearchItems(indexes), [indexes]);
  const [view, setView] = useState<ViewState>(() => parseHash(window.location.hash, indexes));
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const openSearch = useCallback(() => {
    setSearching(true);
  }, []);
  useSearchShortcut(openSearch);

  // The hash mirrors the view; replaceState does not fire hashchange, so there is no loop.
  useEffect(() => {
    const hash = formatHash(view);
    if (hash !== window.location.hash) {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${search}${hash}`);
    }
  }, [view]);
  useEffect(() => {
    const onHashChange = (): void => {
      setView((current) => {
        const next = parseHash(window.location.hash, indexes);
        return sameView(current, next) ? current : next;
      });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [indexes]);

  const visible = useMemo(() => visibleTables(indexes, view), [indexes, view]);
  const highlighted = useMemo(() => new Set(view.focus), [view.focus]);
  const total = snapshot.tables?.length ?? 0;

  const onSelect = (item: SearchItem): void => {
    setSearching(false);
    const targets = focusTargets(indexes, item);
    if (targets.length === 0) {
      setNotice(`${item.context}.${item.name} does not read any table on the map.`);
      return;
    }
    setNotice(null);
    setView(makeViewState(targets, view.hops, view.schemas));
  };

  return (
    <div className="sm-app">
      <header className="sm-app__bar">
        <h1>Schema Map</h1>
        <span className="sm-app__db" title={snapshot.source.database}>
          {snapshot.source.database}
        </span>
      </header>
      <Toolbar
        indexes={indexes}
        state={view}
        onChange={(next) => {
          setNotice(null);
          setView(next);
        }}
        onSearch={openSearch}
        shown={visible === null ? total : visible.size}
        total={total}
      />
      {notice === null ? null : (
        <p className="sm-notice sm-notice--bar" role="status">
          {notice}
        </p>
      )}
      <GraphCanvas indexes={indexes} visible={visible} highlighted={highlighted} />
      {searching ? (
        <Palette
          items={items}
          onSelect={onSelect}
          onClose={() => {
            setSearching(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Shows the inline snapshot if the page carries one, otherwise a file picker. */
export function App() {
  const [state, setState] = useState<LoadState>(initialState);

  if (state.kind === "loaded") {
    return <Loaded snapshot={state.snapshot} />;
  }

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    loadSnapshotFile(file).then(
      (snapshot) => {
        setState({ kind: "loaded", snapshot });
      },
      (error: unknown) => {
        setState({ kind: "error", message: describe(error) });
      },
    );
  };

  return (
    <main className="sm-empty">
      <h1>Schema Map</h1>
      <p>
        Open a snapshot made by <code>schemamap extract</code> (.json or .json.gz).
      </p>
      <label className="sm-empty__pick">
        Open snapshot
        <input type="file" accept=".json,.gz,application/json,application/gzip" onChange={onFile} />
      </label>
      {state.kind === "error" ? (
        <p className="sm-empty__error" role="alert">
          {state.message}
        </p>
      ) : null}
    </main>
  );
}

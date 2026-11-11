import "./tokens.css";
import "./app.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { DetailPanel } from "./detail/DetailPanel";
import { describeObject } from "./detail/model";
import type { SchemaMapSnapshotV1 } from "./generated/snapshot";
import { GraphCanvas } from "./graph/GraphCanvas";
import { OverviewCanvas, type DrillTarget } from "./graph/OverviewCanvas";
import { plainMessage, SnapshotLoadError } from "./snapshot/errors";
import { formatCapturedAt } from "./snapshot/display";
import { StateCard } from "./ui/StateCard";
import { buildIndexes } from "./snapshot/indexes";
import { loadSnapshotFile, readInlineSnapshot } from "./snapshot/load";
import { Palette, useSearchShortcut } from "./search/Palette";
import { buildSearchItems, type SearchItem } from "./search/searchIndex";
import { clusterTables } from "./view/clusters";
import { focusTargets, visibleTables } from "./view/focus";
import {
  allowedHops,
  clampHops,
  drillGroup,
  drillInto,
  drillSchema,
  levelSchema,
  levelSizes,
  rootLevel,
  selectObject,
  viewLevel,
  type Places,
} from "./view/level";
import { foldSchemas } from "./view/schemaGroups";
import { Toolbar } from "./view/Toolbar";
import {
  formatHash,
  parseHash,
  sameView,
  makeViewState,
  withSelected,
  type ViewState,
} from "./view/viewState";

/**
 * A table to centre on inside a cluster, small group or schema map (its `place`: the id in the
 * hash), set when a selection drilled or moved to it.
 */
interface CenterTarget {
  readonly place: string;
  readonly tableId: string;
}

/** The cluster, small group or schema a view is drilled into, or `null` at the root. */
function placeOf(view: ViewState): string | null {
  return view.cluster ?? view.group ?? view.drill;
}

/** The view a box on the overview opens. */
function drillTo(view: ViewState, target: DrillTarget): ViewState {
  if (target.kind === "schema") {
    return drillSchema(view, target.id);
  }
  return target.kind === "group" ? drillGroup(view, target.id) : drillInto(view, target.id);
}

type LoadState =
  | { kind: "empty" }
  | { kind: "error"; plain: string; message: string; details: readonly string[] }
  | { kind: "loaded"; snapshot: SchemaMapSnapshotV1 };

function describe(error: unknown): {
  plain: string;
  message: string;
  details: readonly string[];
} {
  return error instanceof SnapshotLoadError
    ? { plain: plainMessage(error.kind), message: error.message, details: error.details }
    : {
        plain: "That file could not be read.",
        message: "The snapshot could not be read.",
        details: [],
      };
}

function initialState(): LoadState {
  try {
    const snapshot = readInlineSnapshot();
    return snapshot === null ? { kind: "empty" } : { kind: "loaded", snapshot };
  } catch (error) {
    return { kind: "error", ...describe(error) };
  }
}

function Loaded({ snapshot }: { snapshot: SchemaMapSnapshotV1 }) {
  const indexes = useMemo(() => buildIndexes(snapshot), [snapshot]);
  const items = useMemo(() => buildSearchItems(indexes), [indexes]);
  const clustering = useMemo(() => clusterTables(indexes), [indexes]);
  const folding = useMemo(() => foldSchemas(clustering), [clustering]);
  const readHash = useCallback(
    (hash: string): ViewState =>
      clampHops(
        indexes,
        parseHash(hash, indexes, new Set(clustering.byId.keys()), new Set(folding.groups.keys())),
      ),
    [indexes, clustering, folding],
  );
  const [view, setViewRaw] = useState<ViewState>(() => readHash(window.location.hash));
  // Every change goes through the hop limit, so no focus view ever exceeds one layout.
  const setView = useCallback(
    (next: ViewState): void => {
      setViewRaw(clampHops(indexes, next));
    },
    [indexes],
  );
  const level = useMemo(() => viewLevel(view, levelSizes(indexes, view)), [indexes, view]);
  const places = useMemo<Places>(
    () => ({ clustering, folding, rootLevel: rootLevel(indexes, view) }),
    [indexes, clustering, folding, view],
  );
  const [center, setCenter] = useState<CenterTarget | null>(() => {
    const place = placeOf(view);
    return place !== null && view.selected !== null ? { place, tableId: view.selected } : null;
  });
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
      setViewRaw((before) => {
        const next = readHash(window.location.hash);
        return sameView(before, next) ? before : next;
      });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [readHash]);

  const selected = view.selected;
  const model = useMemo(
    () => (selected === null ? undefined : describeObject(indexes, selected)),
    [indexes, selected],
  );
  const panel = useRef<HTMLElement>(null);
  const canvasRegion = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previousSelected = useRef<string | null>(selected);

  // Opening or changing the selection moves focus into the panel, except on first load, where a
  // restored selection must not steal focus. The element focused when the panel first opened is
  // remembered so closing can hand focus back to it.
  useEffect(() => {
    const before = previousSelected.current;
    previousSelected.current = selected;
    if (selected === null || selected === before) {
      return;
    }
    if (before === null) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    panel.current?.querySelector<HTMLElement>("[data-panel-heading]")?.focus();
  }, [selected]);

  // A drill-down or breadcrumb click can remove the element that had focus. When that leaves
  // focus on the page body, it moves to the map, so keyboard users never start over from the top.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement === null) {
        canvasRegion.current?.focus();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [view]);

  // Selecting a table that is not on screen (from the overview, or another cluster, small group
  // or schema) moves to the deepest view that shows it. `centre` also brings the table into view;
  // a click on a node does not need it.
  const select = useCallback(
    (id: string, centre: boolean): void => {
      const next = selectObject(view, id, places, level);
      setView(next);
      const place = placeOf(next);
      const moved = place !== placeOf(view);
      if (
        (centre || moved) &&
        next.focus.length === 0 &&
        place !== null &&
        indexes.byId(id)?.kind === "table"
      ) {
        setCenter({ place, tableId: id });
      }
    },
    [view, places, level, setView, indexes],
  );
  const open = useCallback(
    (id: string): void => {
      select(id, true);
    },
    [select],
  );
  const close = useCallback((): void => {
    const back = opener.current;
    opener.current = null;
    setView(withSelected(view, null));
    if (back?.isConnected === true) {
      back.focus();
    }
  }, [view, setView]);
  useEffect(() => {
    if (selected === null) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [selected, close]);

  const boxes = level === "overview" || level === "schema";
  const visible = useMemo(
    () => (boxes ? null : visibleTables(indexes, view, clustering, folding)),
    [indexes, view, clustering, folding, boxes],
  );
  const maxHops = useMemo(
    () => (view.focus.length === 0 ? 3 : allowedHops(indexes, view.focus, view.schemas)),
    [indexes, view.focus, view.schemas],
  );
  // Tables shown for a place (a cluster, a small group or a schema's map) can be centred on.
  const scoped = level === "cluster" || (level === "map" && view.drill !== null);
  const centerOn =
    scoped && center !== null && center.place === placeOf(view) ? center.tableId : null;
  const highlighted = useMemo(
    () => new Set(selected === null ? view.focus : [...view.focus, selected]),
    [view.focus, selected],
  );
  const total = snapshot.tables?.length ?? 0;

  // On the overview, a schema's level or a place, a table result moves to the table; elsewhere,
  // and for views, the result is focused as on the full map.
  const onSelect = (item: SearchItem): void => {
    setSearching(false);
    if ((boxes || scoped) && item.targetKind === "table") {
      setNotice(null);
      select(item.targetId, true);
      return;
    }
    const targets = focusTargets(indexes, item);
    if (targets.length === 0) {
      setNotice(`${item.context}.${item.name} does not read any table on the map.`);
      setView(withSelected(view, item.targetId));
      return;
    }
    setNotice(null);
    setView(makeViewState(targets, view.hops, view.schemas, item.targetId, null));
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
        clustering={clustering}
        folding={folding}
        level={level}
        maxHops={maxHops}
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
      <div className="sm-app__body">
        <div
          ref={canvasRegion}
          className="sm-app__canvas"
          role="region"
          aria-label="Schema map"
          tabIndex={-1}
        >
          {boxes ? (
            <OverviewCanvas
              clustering={clustering}
              folding={folding}
              schema={level === "schema" ? levelSchema(indexes, view) : null}
              schemas={view.schemas}
              onDrill={(target) => {
                setView(drillTo(view, target));
              }}
            />
          ) : (
            <GraphCanvas
              indexes={indexes}
              visible={visible}
              highlighted={highlighted}
              onOpen={(id) => {
                select(id, false);
              }}
              centerOn={centerOn}
            />
          )}
        </div>
        {model === undefined ? null : (
          <DetailPanel ref={panel} model={model} onSelect={open} onClose={close} />
        )}
      </div>
      <footer className="sm-app__footer" aria-label="About this map">
        <strong>About this map</strong>
        <span>
          Schema Map {snapshot.generator.version} · viewer {__VIEWER_VERSION__}
        </span>
        <span>Extracted {formatCapturedAt(snapshot.captured_at)}</span>
        <span>Read-only: built from metadata, no row data</span>
      </footer>
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
        setState({ kind: "error", ...describe(error) });
      },
    );
  };

  const picker = (
    <label className="sm-button">
      {state.kind === "error" ? "Open another snapshot" : "Open snapshot"}
      <input type="file" accept=".json,.gz,application/json,application/gzip" onChange={onFile} />
    </label>
  );

  return (
    <main className="sm-page">
      <h1 className="sm-page__brand">Schema Map</h1>
      {state.kind === "error" ? (
        <StateCard
          tone="error"
          title="This snapshot could not be opened"
          role="alert"
          actions={picker}
        >
          <p>{state.plain}</p>
          <details className="sm-state__more">
            <summary>Details</summary>
            <p className="sm-state__technical">{state.message}</p>
            {state.details.length === 0 ? null : (
              <ul className="sm-state__details">
                {state.details.map((line, index) => (
                  <li key={String(index)}>{line}</li>
                ))}
              </ul>
            )}
          </details>
        </StateCard>
      ) : (
        <StateCard title="Open a snapshot to see the map" actions={picker}>
          <p>
            Choose a file made by <code>schemamap extract</code> (.json or .json.gz). It is read on
            this computer and never uploaded.
          </p>
        </StateCard>
      )}
    </main>
  );
}

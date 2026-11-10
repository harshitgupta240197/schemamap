import "./app.css";
import { useMemo, useState, type ChangeEvent } from "react";
import type { SchemaMapSnapshotV1 } from "./generated/snapshot";
import { GraphCanvas } from "./graph/GraphCanvas";
import { SnapshotLoadError } from "./snapshot/errors";
import { buildIndexes } from "./snapshot/indexes";
import { loadSnapshotFile, readInlineSnapshot } from "./snapshot/load";

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
  return (
    <div className="sm-app">
      <header className="sm-app__bar">
        <h1>Schema Map</h1>
        <span className="sm-app__db" title={snapshot.source.database}>
          {snapshot.source.database}
        </span>
      </header>
      <GraphCanvas indexes={indexes} />
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

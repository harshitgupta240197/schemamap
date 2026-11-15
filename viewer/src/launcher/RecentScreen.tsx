import { useCallback, useEffect, useRef, useState } from "react";
import { deleteMap, fetchMaps, importMap } from "./client";
import { HowToFix, Icon, Main, ScreenHeading, StateTile } from "./Chrome";
import { formatExtracted, formatSize } from "./maps";
import type { Failure, MapEntry } from "./model";

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly maps: readonly MapEntry[] }
  | { readonly kind: "failed"; readonly failure: Failure };

interface Props {
  readonly token: string;
  readonly onNewConnection: () => void;
  readonly onRerun: (map: MapEntry) => void;
}

/** Maps saved on this computer: open, re-run, delete, or add one from a snapshot file. */
export function RecentScreen({ token, onNewConnection, onRerun }: Props) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    readonly tone: "ok" | "error";
    readonly text: string;
  } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);

  const load = useCallback(() => {
    void fetchMaps(token).then((outcome) => {
      if (!alive.current) return;
      setList(
        outcome.ok
          ? { kind: "ready", maps: outcome.value }
          : { kind: "failed", failure: outcome.failure },
      );
    });
  }, [token]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (confirming !== null) keepButton.current?.focus();
  }, [confirming]);

  const remove = (map: MapEntry) => {
    setNotice(null);
    void deleteMap(token, map.id).then((outcome) => {
      if (!alive.current) return;
      setConfirming(null);
      if (outcome.ok) {
        setNotice({ tone: "ok", text: `Deleted the map of ${map.database}.` });
        load();
      } else {
        setNotice({ tone: "error", text: outcome.failure.message });
      }
    });
  };

  const upload = (file: File) => {
    setNotice(null);
    void importMap(token, file).then((outcome) => {
      if (!alive.current) return;
      if (outcome.ok) {
        setNotice({ tone: "ok", text: `Added a map from ${file.name}.` });
        load();
      } else {
        setNotice({
          tone: "error",
          text: `That file could not be used. ${outcome.failure.message} Use a .json or .json.gz file made by schemamap extract.`,
        });
      }
    });
  };

  return (
    <Main>
      <div className="lc-title lc-title--row">
        <div className="lc-title">
          <ScreenHeading focus>Recent maps</ScreenHeading>
          <p className="lc-lede">
            Maps saved on this computer. Open one, refresh it from the database, or remove it.
          </p>
        </div>
        <div className="lc-actions">
          <input
            ref={picker}
            type="file"
            hidden
            tabIndex={-1}
            aria-label="Snapshot file"
            accept=".json,.gz,application/json,application/gzip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) upload(file);
            }}
          />
          <button
            type="button"
            className="lc-btn lc-btn--secondary"
            onClick={() => {
              picker.current?.click();
            }}
          >
            <Icon name="upload" size={18} />
            <span>Open a snapshot file</span>
          </button>
          <button type="button" className="lc-btn lc-btn--primary" onClick={onNewConnection}>
            New connection
          </button>
        </div>
      </div>
      {notice === null ? null : (
        <p
          className={notice.tone === "error" ? "lc-note lc-note--warn" : "lc-note"}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      {list.kind === "loading" ? (
        <section className="lc-card lc-card--state">
          <p className="lc-running" role="status">
            <span className="lc-spinner" aria-hidden="true" />
            Loading maps…
          </p>
        </section>
      ) : null}
      {list.kind === "failed" ? (
        <section className="lc-card lc-card--state" aria-labelledby="recent-err-h">
          <StateTile tone="fail" />
          <h2 id="recent-err-h" className="lc-h2 lc-h2--state">
            Couldn’t load your maps
          </h2>
          <p role="alert">{list.failure.message}</p>
          {list.failure.fix === null ? null : <HowToFix fix={list.failure.fix} />}
          <button type="button" className="lc-btn lc-btn--primary" onClick={load}>
            <Icon name="refresh" size={18} />
            <span>Try again</span>
          </button>
        </section>
      ) : null}
      {list.kind === "ready" && list.maps.length === 0 ? (
        <section className="lc-card lc-card--state">
          <p>No maps yet. Connect to a database to make your first one.</p>
        </section>
      ) : null}
      {list.kind === "ready" && list.maps.length > 0 ? (
        <section className="lc-card lc-card--maps" aria-labelledby="saved-h">
          <h2 id="saved-h" className="lc-sr">
            Saved maps
          </h2>
          <table className="lc-maps">
            <thead>
              <tr>
                <th scope="col">Database</th>
                <th scope="col">Server</th>
                <th scope="col">Extracted</th>
                <th scope="col" className="lc-num">
                  Tables
                </th>
                <th scope="col" className="lc-num">
                  Size
                </th>
                <th scope="col">
                  <span className="lc-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.maps.flatMap((map) => {
                const rows = [
                  <tr key={map.id}>
                    <th scope="row">
                      <span className="lc-maps__db">
                        <Icon name="database" size={18} />
                        <span>{map.database}</span>
                      </span>
                    </th>
                    <td data-label="Server">{map.server ?? "Unknown"}</td>
                    <td data-label="Extracted">{formatExtracted(map.extractedAt)}</td>
                    <td data-label="Tables" className="lc-num">
                      {map.tables.toLocaleString("en-US")}
                    </td>
                    <td data-label="Size" className="lc-num">
                      {formatSize(map.bytes)}
                    </td>
                    <td className="lc-maps__actions">
                      <a
                        className="lc-btn lc-btn--secondary lc-btn--small"
                        href={`/maps/${map.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open the map of ${map.database} (opens in a new tab)`}
                      >
                        Open
                      </a>
                      <button
                        type="button"
                        className="lc-btn lc-btn--secondary lc-btn--small"
                        aria-label={`Re-run ${map.database}`}
                        onClick={() => {
                          onRerun(map);
                        }}
                      >
                        Re-run
                      </button>
                      <button
                        type="button"
                        className="lc-btn lc-btn--ghost lc-btn--small"
                        aria-label={`Delete the map of ${map.database}`}
                        onClick={() => {
                          setConfirming(map.id);
                        }}
                      >
                        <Icon name="trash" size={16} />
                        <span>Delete</span>
                      </button>
                    </td>
                  </tr>,
                ];
                if (confirming === map.id) {
                  rows.push(
                    <tr key={`${map.id}-confirm`} className="lc-maps__confirm">
                      <td colSpan={6}>
                        <div
                          role="group"
                          aria-label={`Delete the map of ${map.database}?`}
                          className="lc-confirm"
                        >
                          <div className="lc-confirm__text">
                            <Icon name="warn" size={20} />
                            <div>
                              <p className="lc-confirm__title">Delete the map of {map.database}?</p>
                              <p className="lc-hint">
                                This removes the map and its snapshot from this computer. The
                                database isn’t touched.
                              </p>
                            </div>
                          </div>
                          <div className="lc-actions">
                            <button
                              ref={keepButton}
                              type="button"
                              className="lc-btn lc-btn--secondary lc-btn--small"
                              onClick={() => {
                                setConfirming(null);
                              }}
                            >
                              Keep
                            </button>
                            <button
                              type="button"
                              className="lc-btn lc-btn--danger lc-btn--small"
                              onClick={() => {
                                remove(map);
                              }}
                            >
                              Delete map
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        </section>
      ) : null}
      <p className="lc-hint lc-hint--page">
        Re-run asks for the password again, because Schema Map never saves passwords. “Open a
        snapshot file” accepts .json or .json.gz files made by schemamap extract.
      </p>
    </Main>
  );
}

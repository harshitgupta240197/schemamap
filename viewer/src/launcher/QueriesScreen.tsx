import { useEffect, useMemo, useState } from "react";
import { fetchQueries } from "./client";
import { HowToFix, Icon, Main, ScreenHeading, ScriptBlock, StateTile } from "./Chrome";
import type { Failure, QueryCatalog } from "./model";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly failure: Failure }
  | { readonly kind: "ready"; readonly catalog: QueryCatalog };

/** The queries this version can send, read from the files it ships with: all of them, offline. */
export function QueriesScreen({
  token,
  onBack,
}: {
  readonly token: string;
  readonly onBack: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [search, setSearch] = useState("");

  useEffect(() => {
    const alive = { current: true };
    void fetchQueries(token).then((outcome) => {
      if (!alive.current) return;
      setState(
        outcome.ok
          ? { kind: "ready", catalog: outcome.value }
          : { kind: "failed", failure: outcome.failure },
      );
    });
    return () => {
      alive.current = false;
    };
  }, [token]);

  const needle = search.trim().toLowerCase();
  const shown = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.catalog.queries.filter(
      (query) =>
        needle === "" ||
        `${query.name}\n${query.purpose}\n${query.sql}`.toLowerCase().includes(needle),
    );
  }, [state, needle]);

  return (
    <Main>
      <div className="lc-title">
        <ScreenHeading focus>Queries Schema Map runs</ScreenHeading>
        <p className="lc-lede">
          These are the only queries this version can send. All read system catalog views; none read
          your tables.
          {state.kind === "ready" ? ` Version ${state.catalog.version}.` : ""}
        </p>
      </div>
      {state.kind === "loading" ? (
        <section className="lc-card lc-card--state">
          <p className="lc-running" role="status">
            <span className="lc-spinner" aria-hidden="true" />
            Loading the queries…
          </p>
        </section>
      ) : null}
      {state.kind === "failed" ? (
        <section className="lc-card lc-card--state" aria-labelledby="q-err-h">
          <StateTile tone="fail" />
          <h2 id="q-err-h" className="lc-h2 lc-h2--state">
            Couldn’t load the queries
          </h2>
          <p role="alert">{state.failure.message}</p>
          {state.failure.fix === null ? null : <HowToFix fix={state.failure.fix} />}
        </section>
      ) : null}
      {state.kind === "ready" ? (
        <>
          <div className="lc-queries__tools">
            <div className="lc-search">
              <span className="lc-search__icon" aria-hidden="true">
                <Icon name="search" size={18} />
              </span>
              <input
                type="search"
                className="lc-input lc-search__input"
                aria-label="Search queries"
                placeholder="Search by name, purpose or SQL"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </div>
            <p className="lc-count-text" role="status">
              {shown.length === state.catalog.queries.length
                ? `${String(shown.length)} queries`
                : `${String(shown.length)} of ${String(state.catalog.queries.length)} queries`}
            </p>
          </div>
          {shown.length === 0 ? (
            <section className="lc-card lc-card--state">
              <p>No query matches “{search.trim()}”.</p>
            </section>
          ) : (
            <ul className="lc-queries">
              {shown.map((query) => (
                <li key={query.name} className="lc-queries__item">
                  <h2 className="lc-h3 lc-queries__name">{query.name}</h2>
                  <p className="lc-queries__purpose">{query.purpose}</p>
                  <ScriptBlock
                    script={query.sql}
                    title={`${query.name}.sql`}
                    copyName={`${query.name} query`}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      <div className="lc-actions lc-actions--top">
        <button type="button" className="lc-btn lc-btn--secondary" onClick={onBack}>
          <Icon name="back" size={18} />
          <span>Back</span>
        </button>
      </div>
    </Main>
  );
}

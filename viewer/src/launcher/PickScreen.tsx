import { useState, type ReactNode } from "react";
import { Icon, ScreenHeading, ScriptBlock } from "./Chrome";
import { endpointLabel, type FormState } from "./form";
import type { Failure } from "./model";
import { permissionScript } from "./permissionScript";

export type PickState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly names: readonly string[] }
  | { readonly kind: "failed"; readonly failure: Failure };

const SYSTEM_DATABASES = new Set(["master", "model", "msdb", "tempdb"]);

interface Props {
  readonly form: FormState;
  readonly state: PickState;
  readonly includeSystem: boolean;
  readonly onIncludeSystem: (include: boolean) => void;
  readonly onRetry: () => void;
  readonly onEdit: () => void;
  readonly onBack: () => void;
}

/** Step 3: choose the database to map from the ones this login can open. */
export function PickScreen({
  form,
  state,
  includeSystem,
  onIncludeSystem,
  onRetry,
  onEdit,
  onBack,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const where = endpointLabel(form.server.trim(), form.port.trim());
  const who = form.user.trim() === "" ? "" : ` as ${form.user.trim()}`;
  const heading = (
    <div className="lc-title">
      <ScreenHeading focus>Choose a database</ScreenHeading>
      <p className="lc-lede">
        On {where}
        {who}. Only databases this login can open are listed.
      </p>
    </div>
  );

  const withHeading = (body: ReactNode) => (
    <main className="lc-main">
      {heading}
      {body}
    </main>
  );

  if (state.kind === "loading") {
    return withHeading(
      <>
        <section className="lc-card lc-card--state">
          <p className="lc-running" role="status">
            <span className="lc-spinner" aria-hidden="true" />
            Loading databases…
          </p>
        </section>
      </>,
    );
  }

  if (state.kind === "failed") {
    return withHeading(
      <>
        <section className="lc-card lc-card--state" aria-labelledby="pick-err-h">
          <h2 id="pick-err-h" className="lc-h2 lc-h2--state">
            <Icon name="warn" size={22} />
            Couldn’t load the list of databases
          </h2>
          <p role="alert">{state.failure.message}</p>
          {state.failure.fix === null ? null : (
            <p className="lc-fix">
              <strong>How to fix: </strong>
              {state.failure.fix}
            </p>
          )}
          <div className="lc-actions">
            <button type="button" className="lc-btn lc-btn--primary" onClick={onRetry}>
              <Icon name="refresh" size={18} />
              <span>Try again</span>
            </button>
            <button type="button" className="lc-btn lc-btn--ghost" onClick={onEdit}>
              Edit connection
            </button>
          </div>
        </section>
      </>,
    );
  }

  if (state.names.length === 0) {
    return withHeading(
      <>
        <section className="lc-card lc-card--state" aria-labelledby="pick-empty-h">
          <h2 id="pick-empty-h" className="lc-h2 lc-h2--state">
            <Icon name="database" size={22} />
            This login can’t open any databases yet
          </h2>
          <p>
            {form.user.trim() === "" ? "This login" : form.user.trim()} signed in, but it has no
            user in any database on this server, so there is nothing to map.
          </p>
          <p className="lc-fix">
            <strong>How to fix: </strong>ask a DBA to run this in each database you want to map,
            then check again.
          </p>
          <ScriptBlock
            script={permissionScript(form.user.trim() === "" ? "your_login" : form.user.trim())}
            title="Permission script · T-SQL"
          />
          <div className="lc-actions">
            <button type="button" className="lc-btn lc-btn--primary" onClick={onRetry}>
              <Icon name="refresh" size={18} />
              <span>Check again</span>
            </button>
            <button type="button" className="lc-btn lc-btn--ghost" onClick={onEdit}>
              Edit connection
            </button>
          </div>
        </section>
      </>,
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = state.names.filter((name) => needle === "" || name.toLowerCase().includes(needle));
  const total = state.names.length;
  const countText =
    needle === ""
      ? `${String(total)} ${total === 1 ? "database" : "databases"}`
      : `${String(shown.length)} of ${String(total)} databases`;
  const chosen = selected !== null && state.names.includes(selected) ? selected : null;

  return withHeading(
    <>
      <section className="lc-card lc-card--pick">
        <div className="lc-pick-tools">
          <div className="lc-search">
            <label htmlFor="q" className="lc-sr">
              Search databases
            </label>
            <span className="lc-search__icon">
              <Icon name="search" size={18} />
            </span>
            <input
              id="q"
              className="lc-input lc-search__input"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search databases"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <label className="lc-check lc-check--inline">
            <input
              type="checkbox"
              checked={includeSystem}
              onChange={(event) => {
                onIncludeSystem(event.target.checked);
              }}
            />
            <span className="lc-check__title">Show system databases</span>
          </label>
        </div>
        <p className="lc-hint lc-count-text" aria-live="polite">
          {countText}
        </p>
        <fieldset className="lc-fieldset lc-dblist">
          <legend className="lc-sr">Databases</legend>
          {shown.map((name) => (
            <label key={name} className="lc-dbrow">
              <input
                type="radio"
                name="db"
                value={name}
                checked={chosen === name}
                onChange={() => {
                  setSelected(name);
                }}
              />
              <Icon name="database" size={18} />
              <span className="lc-dbrow__text">
                <span className="lc-dbrow__name">{name}</span>
                {SYSTEM_DATABASES.has(name) ? (
                  <span className="lc-dbrow__meta">System database</span>
                ) : null}
              </span>
            </label>
          ))}
          {shown.length === 0 ? (
            <div className="lc-noresults">
              <p>No database matches “{query.trim()}”.</p>
              <button
                type="button"
                className="lc-btn lc-btn--secondary"
                onClick={() => {
                  setQuery("");
                }}
              >
                Clear search
              </button>
            </div>
          ) : null}
        </fieldset>
        <div className="lc-pick-foot">
          <span className="lc-hint" role="status">
            {chosen === null ? "Pick a database" : `${chosen} selected`}
          </span>
          <div className="lc-actions">
            <button type="button" className="lc-btn lc-btn--ghost" onClick={onBack}>
              <Icon name="back" size={18} />
              <span>Back</span>
            </button>
            <button type="button" className="lc-btn lc-btn--primary" disabled>
              Extract map
            </button>
          </div>
        </div>
        <p className="lc-hint">Extracting a map is the next step and is not in this release yet.</p>
      </section>
    </>,
  );
}

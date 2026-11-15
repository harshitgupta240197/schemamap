import { useState, type ReactNode } from "react";
import { CheckItem } from "./CheckScreen";
import { Icon, ScreenHeading, ScriptBlock } from "./Chrome";
import { endpointLabel, type FormState } from "./form";
import type { Failure, TestResult } from "./model";
import { combinedFixScript, permissionScript } from "./permissionScript";

export type PickState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly names: readonly string[] }
  | { readonly kind: "failed"; readonly failure: Failure };

/** The permission checks run on the chosen database when "Extract map" is pressed. */
export type DatabaseCheckState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly database: string }
  | { readonly kind: "done"; readonly database: string; readonly result: TestResult }
  | { readonly kind: "failed"; readonly database: string; readonly failure: Failure };

const SYSTEM_DATABASES = new Set(["master", "model", "msdb", "tempdb"]);

interface Props {
  readonly form: FormState;
  readonly state: PickState;
  readonly dbCheck: DatabaseCheckState;
  readonly onExtract: (database: string) => void;
  readonly onSelect: () => void;
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
  dbCheck,
  onExtract,
  onSelect,
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
  const checked = chosen !== null && dbCheck.kind !== "idle" && dbCheck.database === chosen;
  const running = checked && dbCheck.kind === "running";
  const passed = checked && dbCheck.kind === "done" && !dbCheck.result.checks.some(isFail);

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
                  onSelect();
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
            <button
              type="button"
              className="lc-btn lc-btn--primary"
              disabled={chosen === null || running || passed}
              onClick={() => {
                if (chosen !== null) onExtract(chosen);
              }}
            >
              Extract map
            </button>
          </div>
        </div>
        {passed ? (
          <p className="lc-hint">
            Extracting a map is the next step and is not in this release yet.
          </p>
        ) : null}
      </section>
      {checked ? <DatabaseResults state={dbCheck} /> : null}
    </>,
  );
}

function isFail(check: { readonly status: string }): boolean {
  return check.status === "fail";
}

/** What the permission checks on the chosen database found, with one script for a DBA. */
function DatabaseResults({ state }: { readonly state: DatabaseCheckState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "running") {
    return (
      <section className="lc-card lc-card--state lc-card--dbcheck" aria-labelledby="dbchk-h">
        <h2 id="dbchk-h" className="lc-sr">
          Database permission checks
        </h2>
        <p className="lc-running" role="status">
          <span className="lc-spinner" aria-hidden="true" />
          Checking permissions on {state.database}…
        </p>
      </section>
    );
  }
  if (state.kind === "failed") {
    return (
      <section className="lc-card lc-card--state lc-card--dbcheck" aria-labelledby="dbchk-h">
        <h2 id="dbchk-h" className="lc-h2 lc-h2--state">
          <Icon name="warn" size={22} />
          The checks could not run
        </h2>
        <p role="alert">{state.failure.message}</p>
        {state.failure.fix === null ? null : (
          <p className="lc-fix">
            <strong>How to fix: </strong>
            {state.failure.fix}
          </p>
        )}
      </section>
    );
  }
  const shown = state.result.checks.filter(
    (check) => check.status !== "ok" && (check.scope === "database" || !state.result.connected),
  );
  const failed = state.result.checks.some(isFail);
  if (shown.length === 0) {
    return (
      <p className="lc-hint lc-hint--page lc-dbcheck-ok" role="status">
        Permissions on {state.database} look good.
      </p>
    );
  }
  const script = combinedFixScript(shown.map((check) => check.fixSql));
  return (
    <section className="lc-card lc-card--results lc-card--dbcheck" aria-labelledby="dbchk-h">
      <h2 id="dbchk-h" className="lc-h2">
        {failed ? `${state.database} needs a permission` : `Permissions on ${state.database}`}
      </h2>
      <ul className="lc-checklist">
        {shown.map((check, index) => (
          <CheckItem key={`${check.name}-${String(index)}`} check={check} showScript={false} />
        ))}
      </ul>
      {script === "" ? null : <ScriptBlock script={script} title="Permission script · T-SQL" />}
    </section>
  );
}

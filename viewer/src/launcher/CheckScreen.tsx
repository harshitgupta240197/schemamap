import { Icon, ScreenHeading, ScriptBlock, type IconName } from "./Chrome";
import { endpointLabel, type FormState } from "./form";
import type { CheckResult, CheckStatus, Failure, TestResult } from "./model";

export const DATABASE_CHECKS_NOTE = "Database permissions are checked when you choose a database.";

export type CheckState =
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly result: TestResult }
  | { readonly kind: "failed"; readonly failure: Failure };

const BADGE: Record<CheckStatus, { word: string; icon: IconName }> = {
  fail: { word: "Needs fixing", icon: "x-circle" },
  warn: { word: "Warning", icon: "warn" },
  ok: { word: "Pass", icon: "check-circle" },
};

/** The checks about the server and sign-in. Database checks wait until a database is chosen. */
function serverChecks(checks: readonly CheckResult[]): CheckResult[] {
  return checks.filter((check) => check.scope === "server");
}

function Summary({ checks }: { readonly checks: readonly CheckResult[] }) {
  const count = (status: CheckStatus) => checks.filter((check) => check.status === status).length;
  const fails = count("fail");
  const warns = count("warn");
  const passes = count("ok");
  return (
    <div className="lc-summary-row">
      <div className="lc-count lc-count--fail">
        <Icon name="x-circle" size={20} />
        <span>
          <strong>{fails}</strong> needs fixing
        </span>
      </div>
      <div className="lc-count lc-count--warn">
        <Icon name="warn" size={20} />
        <span>
          <strong>{warns}</strong> {warns === 1 ? "warning" : "warnings"}
        </span>
      </div>
      <div className="lc-count lc-count--ok">
        <Icon name="check-circle" size={20} />
        <span>
          <strong>{passes}</strong> passed
        </span>
      </div>
    </div>
  );
}

export function CheckItem({
  check,
  showScript = true,
}: {
  readonly check: CheckResult;
  readonly showScript?: boolean;
}) {
  const badge = BADGE[check.status];
  return (
    <li className="lc-check-item">
      <div>
        <span className={`lc-badge lc-badge--${check.status}`}>
          <Icon name={badge.icon} size={15} />
          {badge.word}
        </span>
      </div>
      <div className="lc-check-item__body">
        <h3 className="lc-h3 lc-h3--item">{check.name}</h3>
        <p className="lc-check-item__message">{check.message}</p>
        {check.fix === null ? null : (
          <div className="lc-fix">
            <p>
              <strong>How to fix: </strong>
              {check.fix}
            </p>
            {!showScript || check.fixSql === null ? null : (
              <ScriptBlock script={check.fixSql} title="Permission script · T-SQL" />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

interface Props {
  readonly form: FormState;
  readonly state: CheckState;
  readonly onAgain: () => void;
  readonly onChoose: () => void;
  readonly onEdit: () => void;
}

/** Step 2: what the doctor checks found, worst first, with the fix beside each. */
export function CheckScreen({ form, state, onAgain, onChoose, onEdit }: Props) {
  const where = endpointLabel(form.server.trim(), form.port.trim());
  const who = form.user.trim() === "" ? "" : ` · user ${form.user.trim()}`;
  return (
    <main className="lc-main">
      <div className="lc-title">
        <ScreenHeading focus>Connection checks</ScreenHeading>
        <p className="lc-lede">
          {where}
          {who}. These checks only read metadata and change nothing.
        </p>
      </div>

      {state.kind === "running" ? (
        <section className="lc-card lc-card--state" aria-labelledby="chk-h">
          <h2 id="chk-h" className="lc-sr">
            Check results
          </h2>
          <p className="lc-running" role="status">
            <span className="lc-spinner" aria-hidden="true" />
            Checking the connection…
          </p>
        </section>
      ) : null}

      {state.kind === "failed" ? (
        <section className="lc-card lc-card--state" aria-labelledby="chk-h">
          <h2 id="chk-h" className="lc-h2 lc-h2--state">
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
          <div className="lc-actions">
            <button type="button" className="lc-btn lc-btn--primary" onClick={onAgain}>
              <Icon name="refresh" size={18} />
              <span>Check again</span>
            </button>
            <button type="button" className="lc-btn lc-btn--ghost" onClick={onEdit}>
              <Icon name="back" size={18} />
              <span>Edit connection</span>
            </button>
          </div>
        </section>
      ) : null}

      {state.kind === "done" ? (
        <>
          <section className="lc-card lc-card--results" aria-labelledby="chk-h">
            <h2 id="chk-h" className="lc-sr">
              Check results
            </h2>
            <Summary checks={serverChecks(state.result.checks)} />
            <ul className="lc-checklist">
              {serverChecks(state.result.checks).map((check, index) => (
                <CheckItem key={`${check.name}-${String(index)}`} check={check} />
              ))}
            </ul>
            <p className="lc-hint lc-hint--note">{DATABASE_CHECKS_NOTE}</p>
          </section>
          <div className="lc-actions lc-actions--page">
            <button type="button" className="lc-btn lc-btn--primary" onClick={onAgain}>
              <Icon name="refresh" size={18} />
              <span>Check again</span>
            </button>
            <button type="button" className="lc-btn lc-btn--secondary" onClick={onChoose}>
              Choose a database anyway
            </button>
            <button type="button" className="lc-btn lc-btn--ghost" onClick={onEdit}>
              <Icon name="back" size={18} />
              <span>Edit connection</span>
            </button>
          </div>
          <p className="lc-hint lc-hint--page">
            {state.result.connected
              ? "You can continue: databases where the login already has VIEW DEFINITION will still map."
              : "The login did not open. Fix the connection first, then check again."}
          </p>
        </>
      ) : null}
    </main>
  );
}

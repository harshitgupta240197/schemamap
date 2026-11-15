import { HowToFix, Icon, Main, ScreenHeading, StateTile } from "./Chrome";
import { failedSection, formatElapsed, sectionCount, sectionProgress, sectionTitle } from "./maps";
import type { JobStatus, SectionState } from "./model";

/**
 * What the Extract screen shows: waiting for the job to start, running, failed, or refused because
 * another extract (in another tab) is running. An empty `database` means the extract is one this
 * tab did not start.
 */
export type ExtractState =
  | { readonly kind: "starting"; readonly database: string }
  | {
      readonly kind: "busy";
      readonly database: string;
      /** The running extract, when the server named it. */
      readonly jobId: string | null;
    }
  | {
      readonly kind: "running";
      readonly database: string;
      readonly job: JobStatus;
      readonly cancelling: boolean;
    }
  | {
      readonly kind: "failed";
      readonly database: string;
      readonly job: JobStatus | null;
      readonly message: string;
      readonly fix: string | null;
    };

const STATE_WORDS: Record<SectionState, string> = {
  pending: "Waiting",
  running: "Reading…",
  done: "Done",
  skipped: "Skipped",
  failed: "Stopped",
};

interface Props {
  readonly state: ExtractState;
  readonly where: string;
  readonly onCancel: () => void;
  readonly onTryAgain: () => void;
  readonly onChooseAnother: () => void;
  readonly onEdit: () => void;
  readonly onFollow: (jobId: string) => void;
  readonly onRecent: () => void;
}

/** Step 4: the extract's sections, progress and time; or why it stopped and how to fix it. */
export function ExtractScreen({
  state,
  where,
  onCancel,
  onTryAgain,
  onChooseAnother,
  onEdit,
  onFollow,
  onRecent,
}: Props) {
  if (state.kind === "busy") {
    return (
      <Main>
        <div className="lc-title">
          <ScreenHeading focus>Another extract is running</ScreenHeading>
          <p className="lc-lede">Schema Map runs one extract at a time.</p>
        </div>
        <section className="lc-card lc-card--state" aria-labelledby="ext-busy-h">
          <StateTile tone="warn" />
          <h2 id="ext-busy-h" className="lc-h2 lc-h2--state">
            Another extract is running
          </h2>
          <p role="status">
            An extract is already running, probably in another tab. Nothing is wrong, and your{" "}
            {state.database === "" ? "request" : state.database} was not started.
          </p>
          <HowToFix
            fix={
              state.jobId === null
                ? "wait for it to finish, then try again. Finished maps appear under Recent maps."
                : "follow its progress here, or wait for it to finish and try again."
            }
          />
          <div className="lc-actions">
            {state.jobId === null ? null : (
              <button
                type="button"
                className="lc-btn lc-btn--primary"
                onClick={() => {
                  onFollow(state.jobId ?? "");
                }}
              >
                See its progress
              </button>
            )}
            <button
              type="button"
              className={`lc-btn ${state.jobId === null ? "lc-btn--primary" : "lc-btn--secondary"}`}
              onClick={onRecent}
            >
              <Icon name="clock" size={18} />
              <span>Recent maps</span>
            </button>
            <button type="button" className="lc-btn lc-btn--ghost" onClick={onChooseAnother}>
              Choose another database
            </button>
          </div>
        </section>
      </Main>
    );
  }
  const job = state.kind === "starting" ? null : state.job;
  const failed = state.kind === "failed";
  const stoppedAt = job === null ? null : failedSection(job);
  return (
    <Main>
      <div className="lc-title">
        <ScreenHeading focus>
          {state.database === "" ? "Extract in progress" : `Extracting ${state.database}`}
        </ScreenHeading>
        <p className="lc-lede">Reading system catalog views on {where}. No row data is read.</p>
      </div>
      {state.kind === "failed" ? (
        <section className="lc-banner lc-banner--fail" aria-labelledby="ext-fail-h" role="alert">
          <span className="lc-banner__icon">
            <Icon name="x-circle" size={22} />
          </span>
          <div className="lc-banner__body">
            <h2 id="ext-fail-h" className="lc-h2">
              {stoppedAt === null
                ? "The extract could not finish"
                : `The extract stopped at ${sectionTitle(stoppedAt.name)}`}
            </h2>
            <p>{state.message}</p>
            {state.fix === null ? null : <HowToFix fix={state.fix} />}
            <p className="lc-hint">
              Nothing was saved, so there is no partial map to confuse anyone later.
            </p>
            <div className="lc-actions lc-actions--stopped">
              <button type="button" className="lc-btn lc-btn--primary" onClick={onTryAgain}>
                <Icon name="refresh" size={18} />
                <span>Try again</span>
              </button>
              <button type="button" className="lc-btn lc-btn--secondary" onClick={onEdit}>
                Edit connection
              </button>
              <button type="button" className="lc-btn lc-btn--ghost" onClick={onChooseAnother}>
                Choose another database
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {state.kind === "failed" && job === null ? null : (
        <SectionsCard
          job={job}
          failed={failed}
          cancelling={state.kind === "running" && state.cancelling}
          onCancel={onCancel}
        />
      )}
    </Main>
  );
}

function SectionsCard({
  job,
  failed,
  cancelling,
  onCancel,
}: {
  readonly job: JobStatus | null;
  readonly failed: boolean;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
}) {
  const progress = job === null ? null : sectionProgress(job);
  const ended = job !== null && job.state !== "running";
  const summary =
    progress === null
      ? "Starting…"
      : failed
        ? `${String(progress.finished)} of ${String(progress.total)} sections done before it stopped`
        : `${String(progress.finished)} of ${String(progress.total)} sections done`;
  return (
    <section className="lc-card lc-card--sections" aria-labelledby="ext-sections-h">
      <div className="lc-sections__head">
        <div>
          <h2 id="ext-sections-h" className="lc-h2">
            Sections
          </h2>
          <p className="lc-hint" role="status">
            {summary}
          </p>
        </div>
        <p className="lc-elapsed">Elapsed {formatElapsed(job?.elapsedMs ?? 0)}</p>
      </div>
      <div
        className={failed ? "lc-progress lc-progress--failed" : "lc-progress"}
        role="progressbar"
        aria-label="Extract progress"
        aria-valuemin={0}
        aria-valuemax={progress?.total ?? 1}
        {...(progress === null ? {} : { "aria-valuenow": progress.finished })}
      >
        <div
          className="lc-progress__fill"
          ref={(element) => {
            if (element !== null) {
              element.style.width =
                progress === null || progress.total === 0
                  ? "0%"
                  : `${String((progress.finished / progress.total) * 100)}%`;
            }
          }}
        />
      </div>
      {job === null ? (
        <p className="lc-running">
          <span className="lc-spinner" aria-hidden="true" />
          Starting the extract…
        </p>
      ) : (
        <ul className="lc-sections" aria-label="Sections">
          {job.sections.map((section) => {
            const count = ended && job.state === "done" ? sectionCount(section) : null;
            return (
              <li key={section.name} className={`lc-section lc-section--${section.state}`}>
                <span className="lc-section__mark" aria-hidden="true">
                  {section.state === "running" ? (
                    <span className="lc-spinner" />
                  ) : section.state === "done" ? (
                    <Icon name="check-circle" size={20} />
                  ) : section.state === "failed" ? (
                    <Icon name="x-circle" size={20} />
                  ) : (
                    <span className="lc-section__dot" />
                  )}
                </span>
                <span className="lc-section__name">{sectionTitle(section.name)}</span>
                <span className="lc-section__state">
                  {count === null ? "" : `${count} · `}
                  {STATE_WORDS[section.state]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {failed ? null : (
        <div className="lc-actions lc-actions--top">
          <button
            type="button"
            className="lc-btn lc-btn--secondary"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
          <p className="lc-hint">
            Cancel stops before the next query. Nothing is written to the server and nothing is
            saved.
          </p>
        </div>
      )}
    </section>
  );
}

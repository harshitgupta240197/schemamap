import { useState } from "react";
import { downloadMap } from "./client";
import { Icon, Main, ScreenHeading, StateTile } from "./Chrome";
import { formatExtracted } from "./maps";
import type { MapEntry } from "./model";
import { saveBlob } from "./saveFile";

interface Props {
  readonly token: string;
  readonly mapId: string;
  readonly database: string;
  readonly where: string;
  /** The map's row from the maps list; null when the list could not be read. */
  readonly entry: MapEntry | null;
  readonly onAnother: () => void;
  readonly onRecent: () => void;
}

/** Step 5: the map is saved. Open it in a new tab, save the file, or extract another database. */
export function DoneScreen({ token, mapId, database, where, entry, onAnother, onRecent }: Props) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const facts = [
    entry === null
      ? null
      : `${entry.tables.toLocaleString("en-US")} ${entry.tables === 1 ? "table" : "tables"}`,
    where === "" ? null : where,
    entry === null ? null : `extracted ${formatExtracted(entry.extractedAt)}`,
  ].filter((part): part is string => part !== null);

  const save = () => {
    setBusy(true);
    setProblem(null);
    void downloadMap(token, mapId).then((outcome) => {
      setBusy(false);
      if (outcome.ok) saveBlob(outcome.value.blob, outcome.value.name);
      else setProblem(outcome.failure.message);
    });
  };

  return (
    <Main>
      <section className="lc-card lc-card--state lc-card--done" aria-label="Your map">
        <StateTile tone="ok" icon="check" />
        <div className="lc-title">
          <ScreenHeading focus>
            {database === "" ? "Your map is ready" : `Your map of ${database} is ready`}
          </ScreenHeading>
          <p className="lc-lede">{facts.join(" · ")}</p>
        </div>
        <div className="lc-actions">
          <a
            className="lc-btn lc-btn--primary"
            href={`/maps/${mapId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="external" size={18} />
            <span>Open map</span>
            <span className="lc-btn__aside">(opens in a new tab)</span>
          </a>
          <button type="button" className="lc-btn lc-btn--secondary" disabled={busy} onClick={save}>
            <Icon name="download" size={18} />
            <span>Save map file</span>
          </button>
        </div>
        {problem === null ? null : <p role="alert">{problem}</p>}
        <p className="lc-hint">
          The map file is a single HTML file. It works offline and makes no network requests, so it
          is safe to open anywhere.
        </p>
        <div className="lc-actions lc-actions--top">
          <button type="button" className="lc-btn lc-btn--ghost" onClick={onAnother}>
            <Icon name="plus" size={18} />
            <span>Extract another database</span>
          </button>
          <p className="lc-hint lc-hint--folder">
            <Icon name="folder" size={15} />
            Kept on this computer. Find it later under{" "}
            <button type="button" className="lc-link" onClick={onRecent}>
              Recent maps
            </button>
            .
          </p>
        </div>
      </section>
    </Main>
  );
}

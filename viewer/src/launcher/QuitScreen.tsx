import { ScreenHeading } from "./Chrome";

/** Shown after Quit: the server is gone, so nothing on this page works any more. */
export function QuitScreen() {
  return (
    <main className="lc-main">
      <div className="lc-title">
        <ScreenHeading focus>Schema Map has stopped</ScreenHeading>
        <p className="lc-lede">
          The local server is closed and temporary files are cleaned up. You can close this tab.
        </p>
      </div>
      <section className="lc-card lc-card--state" aria-label="Starting again">
        <p>
          To start again, run <code className="lc-code">schemamap ui</code> in a terminal.
        </p>
      </section>
    </main>
  );
}

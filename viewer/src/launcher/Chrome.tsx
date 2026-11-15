import { useEffect, useRef, useState, type ReactNode } from "react";

/** Line icons (24 px grid). Decorative: the words next to them carry the meaning. */
const PATHS = {
  check: "M20 6 9 17l-5-5",
  "check-circle": "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3",
  "x-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-6 6M9 9l6 6",
  warn: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01",
  lock: "M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "eye-off":
    "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.6A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  copy: "M9 9h11v11H9zM5 15V5a1 1 0 0 1 1-1h10",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  chevron: "m9 18 6-6-6-6",
  database:
    "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  monitor: "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  back: "M19 12H5M12 19l-7-7 7-7",
  x: "M18 6 6 18M6 6l12 12",
  download: "M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  power: "M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0",
  plus: "M12 5v14M5 12h14",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  folder:
    "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
  upload: "M12 15V3m0 0L8 7m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 2,
}: {
  readonly name: IconName;
  readonly size?: number;
  readonly strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The mark from the landing page (site/index.html). */
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#5B3FA0" />
      <rect x="7" y="8" width="8" height="6" rx="1.5" fill="#ffffff" />
      <rect x="17" y="18" width="8" height="6" rx="1.5" fill="#ffffff" />
      <rect x="17" y="8" width="8" height="6" rx="1.5" fill="#BFAEF0" />
      <path d="M15 11h2M21 14v4" stroke="#ffffff" strokeWidth="1.6" />
    </svg>
  );
}

/** The id of the page's main region: the skip link's target. */
export const MAIN_ID = "main-content";

/** The first Tab stop on every screen: visible on focus, it moves focus to the main region. */
function SkipLink() {
  return (
    <a
      className="lc-skip"
      href={`#${MAIN_ID}`}
      onClick={(event) => {
        // Move focus without changing the address: the page's fragment is not ours to rewrite.
        event.preventDefault();
        document.getElementById(MAIN_ID)?.focus();
      }}
    >
      Skip to main content
    </a>
  );
}

/** The one `<main>` of a screen; the skip link lands here. */
export function Main({ children }: { readonly children: ReactNode }) {
  return (
    <main id={MAIN_ID} tabIndex={-1} className="lc-main">
      {children}
    </main>
  );
}

export interface HeaderNav {
  readonly onRecent: () => void;
  readonly onQuit: () => void;
  /** True on the Recent maps screen. */
  readonly recentCurrent: boolean;
}

/**
 * The brand line; with `nav`, the Recent maps and Quit buttons every launcher screen carries.
 * `stopped` (the Quit screen) turns the "running" pill into "Stopped".
 */
export function Header({
  nav,
  stopped = false,
}: {
  readonly nav?: HeaderNav;
  readonly stopped?: boolean;
}) {
  return (
    <>
      <SkipLink />
      <header className="lc-header">
        <div className="lc-brand">
          <Mark />
          <span className="lc-brand__name">Schema Map</span>
          {stopped ? (
            <span className="lc-pill lc-pill--stopped">
              <span className="lc-pill__dot" aria-hidden="true" />
              Stopped
            </span>
          ) : (
            <span className="lc-pill">
              <span className="lc-pill__dot" aria-hidden="true" />
              <span className="lc-pill__long">Running on this computer · 127.0.0.1</span>
              <span className="lc-pill__short">This computer only</span>
            </span>
          )}
        </div>
        {nav === undefined ? null : (
          <nav aria-label="Launcher" className="lc-topnav">
            <button
              type="button"
              className="lc-btn lc-btn--ghost lc-btn--small"
              aria-label="Recent maps"
              aria-current={nav.recentCurrent ? "page" : undefined}
              onClick={nav.onRecent}
            >
              <Icon name="clock" size={18} />
              <span className="lc-btn__label">Recent maps</span>
            </button>
            <button
              type="button"
              className="lc-btn lc-btn--secondary lc-btn--small"
              aria-label="Quit"
              onClick={nav.onQuit}
            >
              <Icon name="power" size={18} />
              <span className="lc-btn__label">Quit</span>
            </button>
          </nav>
        )}
      </header>
    </>
  );
}

export const STEPS = ["Connect", "Check", "Choose database", "Extract", "Open map"] as const;

/** Five steps: a numbered list on a wide screen, "Step n of 5" with bars on a narrow one. */
export function Stepper({ current }: { readonly current: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <nav aria-label="Progress" className="lc-steps">
      <ol className="lc-steps__list">
        {STEPS.map((name, index) => {
          const number = index + 1;
          const done = number < current;
          const here = number === current;
          return (
            <li
              key={name}
              className={`lc-step${here ? " lc-step--here" : ""}${done ? " lc-step--done" : ""}`}
              aria-current={here ? "step" : undefined}
            >
              <span className="lc-step__badge" aria-hidden="true">
                {done ? <Icon name="check" size={14} strokeWidth={3} /> : number}
              </span>
              <span>
                {name}
                {done ? <span className="lc-sr"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="lc-steps__compact" aria-hidden="true">
        <p className="lc-steps__text">
          Step {current} of 5 · {STEPS[current - 1]}
        </p>
        <div className="lc-steps__bars">
          {STEPS.map((name, index) => (
            <span key={name} className={index < current ? "lc-bar lc-bar--on" : "lc-bar"} />
          ))}
        </div>
      </div>
    </nav>
  );
}

export function Footer({ onQueries }: { readonly onQueries?: () => void }) {
  return (
    <footer className="lc-footer">
      <Icon name="lock" size={15} />
      <span>Runs only on this computer at 127.0.0.1. Nothing is sent anywhere.</span>
      {onQueries === undefined ? null : (
        <button type="button" className="lc-link lc-footer__link" onClick={onQueries}>
          See every query it runs
        </button>
      )}
    </footer>
  );
}

/** A page heading that takes focus when the screen changes, so a keyboard or screen reader follows. */
export function ScreenHeading({
  children,
  focus,
}: {
  readonly children: ReactNode;
  readonly focus: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <h1 ref={ref} tabIndex={-1} className="lc-h1">
      {children}
    </h1>
  );
}

/** A SQL script for a DBA, with a Copy button that says "Copied" and announces it. */
export function ScriptBlock({
  script,
  title,
  copyName,
}: {
  readonly script: string;
  readonly title: string;
  /** When set, the button reads "Copy" and is named "Copy <copyName>": many blocks on one page. */
  readonly copyName?: string;
}) {
  const [message, setMessage] = useState<"" | "copied" | "failed">("");
  const copy = () => {
    const write = (): Promise<void> => {
      try {
        return navigator.clipboard.writeText(script);
      } catch {
        return Promise.reject(new Error("no clipboard"));
      }
    };
    write().then(
      () => {
        setMessage("copied");
      },
      () => {
        setMessage("failed");
      },
    );
  };
  return (
    <div className="lc-script">
      <div className="lc-script__bar">
        <span className="lc-script__title">{title}</span>
        <button
          type="button"
          className="lc-btn lc-btn--secondary lc-btn--small"
          onClick={copy}
          {...(copyName === undefined
            ? {}
            : { "aria-label": `${message === "copied" ? "Copied" : "Copy"} ${copyName}` })}
        >
          <Icon name={message === "copied" ? "check" : "copy"} size={16} />
          <span>
            {message === "copied" ? "Copied" : copyName === undefined ? "Copy script" : "Copy"}
          </span>
        </button>
      </div>
      <pre className="lc-script__code" role="region" tabIndex={0} aria-label={title}>
        <code>{script}</code>
      </pre>
      <span className="lc-sr" role="status" aria-live="polite">
        {message === "copied"
          ? "Script copied to the clipboard"
          : message === "failed"
            ? "Could not copy. Select the script and copy it by hand."
            : ""}
      </span>
      {message === "failed" ? (
        <p className="lc-hint">Could not copy. Select the script above and copy it by hand.</p>
      ) : null}
    </div>
  );
}

/** The tones of a state: the status tokens, each with an icon and a word, never colour alone. */
export type Tone = "fail" | "warn" | "ok" | "info";

const TONE_ICON: Record<Tone, IconName> = {
  fail: "warn",
  warn: "warn",
  ok: "check-circle",
  info: "info",
};

/** The icon tile above a state card's heading: one set of tones on every screen. */
export function StateTile({ tone, icon }: { readonly tone: Tone; readonly icon?: IconName }) {
  return (
    <span className={`lc-tile lc-tile--${tone}`} aria-hidden="true">
      <Icon name={icon ?? TONE_ICON[tone]} size={26} />
    </span>
  );
}

/** "How to fix:" followed by the fix, on a line of running text: the one layout on every screen. */
export function HowToFix({ fix }: { readonly fix: string }) {
  return (
    <p className="lc-fix-line">
      <strong>How to fix: </strong>
      {fix}
    </p>
  );
}

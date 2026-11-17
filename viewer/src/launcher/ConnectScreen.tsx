import { useEffect, useRef, useState, type SyntheticEvent, type ReactNode } from "react";
import { Icon, Main, ScreenHeading } from "./Chrome";
import {
  GROUP_LABELS,
  authLabel,
  endpointLabel,
  entraModes,
  offeredGroups,
  selectedMode,
  applyRemembered,
  usable,
  validate,
  type FormErrors,
  type FormState,
} from "./form";
import type { Capabilities, RememberedConnection } from "./model";

const MODE_NOTES: Record<string, string> = {
  windows: "Uses your current Windows sign-in. No user name or password is needed.",
  "entra-interactive": "A Microsoft sign-in page opens in your browser. The user name is optional.",
  "entra-integrated": "Uses the Microsoft account you are signed in to on this computer.",
  "entra-default":
    "Uses the account found on this computer: environment settings, a managed identity or a signed-in developer tool.",
};

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string;
  readonly children: (describedBy: string | undefined, invalid: boolean) => ReactNode;
}

/** A label, the control, and its hint or error, tied together for assistive technology. */
function Field({ id, label, error, hint, children }: FieldProps) {
  const ids = [hint === undefined ? "" : `${id}-hint`, error === undefined ? "" : `${id}-error`]
    .filter((value) => value !== "")
    .join(" ");
  return (
    <div className="lc-field">
      <label htmlFor={id} className="lc-label">
        {label}
      </label>
      {children(ids === "" ? undefined : ids, error !== undefined)}
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="lc-hint">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} className="lc-error">
          <Icon name="x-circle" size={14} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

interface Props {
  readonly caps: Capabilities;
  readonly form: FormState;
  readonly onChange: (form: FormState) => void;
  readonly remembered: readonly RememberedConnection[];
  readonly onForget: (entry: RememberedConnection) => void;
  readonly onSubmit: () => void;
  readonly focusHeading: boolean;
  /** Set when "Forget" could not reach the server. */
  readonly forgetError: string | null;
  /** Open the page that lists every query this version can send. */
  readonly onQueries: () => void;
}

/** Step 1: where to connect and how to sign in. */
const NARROW = "(max-width: 479px)";

/** True while the window is narrower than 480 px, so a long placeholder can be shortened. */
function useNarrow(): boolean {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(NARROW) : null;
  const [narrow, setNarrow] = useState(query?.matches ?? false);
  useEffect(() => {
    if (query === null) return undefined;
    const update = () => {
      setNarrow(query.matches);
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, [query]);
  return narrow;
}

export function ConnectScreen({
  caps,
  form,
  onChange,
  remembered,
  onForget,
  onSubmit,
  focusHeading,
  forgetError,
  onQueries,
}: Props) {
  const narrow = useNarrow();
  const [revealed, setRevealed] = useState(false);
  const [tried, setTried] = useState(false);
  const root = useRef<HTMLFormElement>(null);
  const errors: FormErrors = tried ? validate(form, caps) : {};
  const mode = selectedMode(form, caps);
  const groups = offeredGroups(caps);
  const entra = entraModes(caps);
  const showUser = mode?.needsUser === true || mode?.id === "entra-interactive";
  const showPassword = mode?.needsPassword === true;
  const recents = usable(remembered, caps);
  const set = (change: Partial<FormState>) => {
    onChange({ ...form, ...change });
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setTried(true);
    const first = Object.keys(validate(form, caps))[0];
    if (first === undefined) {
      onSubmit();
      return;
    }
    root.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
  };

  return (
    <Main>
      <div className="lc-title">
        <ScreenHeading focus={focusHeading}>Connect to SQL Server</ScreenHeading>
        <p className="lc-lede">
          Use a read-only login. Schema Map checks the connection and tells you in plain English
          what, if anything, needs fixing.
        </p>
      </div>
      <div className="lc-grid">
        <section className="lc-card lc-card--form" aria-labelledby="conn-h">
          <h2 id="conn-h" className="lc-h2">
            Connection
          </h2>
          <form ref={root} onSubmit={submit} noValidate className="lc-form">
            <div className="lc-row lc-row--server">
              <Field id="server" label="Server" error={errors.server}>
                {(describedBy, invalid) => (
                  <input
                    id="server"
                    data-field="server"
                    className="lc-input"
                    value={form.server}
                    onChange={(event) => {
                      set({ server: event.target.value });
                    }}
                    placeholder={
                      narrow ? "sql01.example.local" : "sql01.example.local or 127.0.0.1"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    aria-required="true"
                  />
                )}
              </Field>
              <Field id="port" label="Port" error={errors.port}>
                {(describedBy, invalid) => (
                  <input
                    id="port"
                    data-field="port"
                    className="lc-input"
                    value={form.port}
                    onChange={(event) => {
                      set({ port: event.target.value });
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                  />
                )}
              </Field>
            </div>

            <fieldset className="lc-fieldset">
              <legend className="lc-label">Sign in with</legend>
              <div className="lc-segs">
                {groups.map((group) => (
                  <label key={group} className="lc-seg">
                    <input
                      className="lc-sr"
                      type="radio"
                      name="auth"
                      value={group}
                      checked={form.group === group}
                      onChange={() => {
                        set({ group });
                      }}
                    />
                    <span>{GROUP_LABELS[group]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {form.group === "entra" && entra.length > 0 ? (
              <div className="lc-field">
                <label htmlFor="entra" className="lc-label">
                  Entra method
                </label>
                <select
                  id="entra"
                  className="lc-input"
                  value={form.entraMode}
                  onChange={(event) => {
                    set({ entraMode: event.target.value });
                  }}
                >
                  {entra.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {mode !== undefined && MODE_NOTES[mode.id] !== undefined ? (
              <div className="lc-note">
                <Icon name="info" size={16} />
                <p>{MODE_NOTES[mode.id]}</p>
              </div>
            ) : null}

            {showUser ? (
              <Field
                id="user"
                label={form.group === "entra" ? "User name (email)" : "User name"}
                error={errors.user}
              >
                {(describedBy, invalid) => (
                  <input
                    id="user"
                    data-field="user"
                    className="lc-input"
                    value={form.user}
                    onChange={(event) => {
                      set({ user: event.target.value });
                    }}
                    autoComplete="username"
                    spellCheck={false}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                  />
                )}
              </Field>
            ) : null}

            {showPassword ? (
              <Field
                id="pw"
                label="Password"
                error={errors.password}
                hint="Kept only in this tab until your map is made. Never saved, logged or shown again."
              >
                {(describedBy, invalid) => (
                  <div className="lc-pw">
                    <input
                      id="pw"
                      data-field="password"
                      className="lc-input"
                      type={revealed ? "text" : "password"}
                      value={form.password}
                      onChange={(event) => {
                        set({ password: event.target.value });
                      }}
                      autoComplete="current-password"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                    />
                    <button
                      type="button"
                      className="lc-btn lc-btn--secondary lc-pw__toggle"
                      aria-pressed={revealed}
                      aria-label="Show password"
                      onClick={() => {
                        setRevealed(!revealed);
                      }}
                    >
                      <Icon name={revealed ? "eye-off" : "eye"} size={17} />
                      <span aria-hidden="true">Show</span>
                    </button>
                  </div>
                )}
              </Field>
            ) : null}

            <div className="lc-checks">
              <label className="lc-check">
                <input
                  type="checkbox"
                  checked={form.trust}
                  aria-describedby="trust-d"
                  onChange={(event) => {
                    set({ trust: event.target.checked });
                  }}
                />
                <span className="lc-check__text">
                  <span className="lc-check__title">
                    Trust server certificate <span className="lc-tag">Local labs only</span>
                  </span>
                  <span id="trust-d" className="lc-hint">
                    Skips checking who issued the server’s certificate. The connection is still
                    encrypted.
                  </span>
                </span>
              </label>
              {form.trust ? (
                <div className="lc-note lc-note--warn" role="note">
                  <Icon name="warn" size={16} />
                  <p>
                    Use this only for a lab on your own machine. For a shared server, install a
                    certificate from a trusted authority on the server instead.
                  </p>
                </div>
              ) : null}
              <label className="lc-check">
                <input
                  type="checkbox"
                  checked={form.remember}
                  aria-describedby="rem-d"
                  onChange={(event) => {
                    set({ remember: event.target.checked });
                  }}
                />
                <span className="lc-check__text">
                  <span className="lc-check__title">Remember this connection</span>
                  <span id="rem-d" className="lc-hint">
                    Saves the server, port, sign-in method and user name on this computer. Never the
                    password.
                  </span>
                </span>
              </label>
            </div>

            <details className="lc-details">
              <summary className="lc-summary">
                <span className="lc-chev">
                  <Icon name="chevron" size={16} />
                </span>
                Advanced
              </summary>
              <div className="lc-row lc-row--timeouts">
                <Field
                  id="ct"
                  label="Connection timeout (seconds)"
                  error={errors.connectTimeout}
                  hint="How long to wait for the server to answer."
                >
                  {(describedBy, invalid) => (
                    <input
                      id="ct"
                      data-field="connectTimeout"
                      className="lc-input"
                      value={form.connectTimeout}
                      onChange={(event) => {
                        set({ connectTimeout: event.target.value });
                      }}
                      inputMode="numeric"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                    />
                  )}
                </Field>
                <Field
                  id="qt"
                  label="Query timeout (seconds)"
                  error={errors.queryTimeout}
                  hint="Per catalog query. Raise it for very large databases."
                >
                  {(describedBy, invalid) => (
                    <input
                      id="qt"
                      data-field="queryTimeout"
                      className="lc-input"
                      value={form.queryTimeout}
                      onChange={(event) => {
                        set({ queryTimeout: event.target.value });
                      }}
                      inputMode="numeric"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                    />
                  )}
                </Field>
              </div>
              <p className="lc-hint">
                Schema Map always connects with read-only intent and runs only its published catalog
                queries.
              </p>
            </details>

            <div className="lc-actions lc-actions--top">
              <button type="submit" className="lc-btn lc-btn--primary">
                Test connection
              </button>
              <span className="lc-hint">Runs read-only checks. Changes nothing on the server.</span>
            </div>
          </form>
        </section>

        <div className="lc-side">
          <section className="lc-card lc-card--side" aria-labelledby="rec-h">
            <h2 id="rec-h" className="lc-h3">
              Recent connections
            </h2>
            <p className="lc-hint">Saved on this computer. Passwords are never saved.</p>
            {recents.length === 0 ? (
              <p className="lc-empty">
                No saved connections yet. Tick “Remember this connection” to keep one here.
              </p>
            ) : (
              <ul className="lc-recents" aria-labelledby="rec-h">
                {recents.map((entry) => (
                  <li key={entry.id} className="lc-recent">
                    <div className="lc-recent__text">
                      <span className="lc-recent__name" title={entry.server}>
                        {endpointLabel(entry.server, entry.port)}
                      </span>
                      <span className="lc-recent__meta">
                        {authLabel(entry, caps)}
                        {entry.user === null ? "" : ` · ${entry.user}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="lc-btn lc-btn--secondary lc-btn--small"
                      aria-label={`Use ${endpointLabel(entry.server, entry.port)}`}
                      onClick={() => {
                        onChange(applyRemembered(form, entry, caps));
                      }}
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      className="lc-btn lc-btn--ghost lc-btn--icon"
                      aria-label={`Forget ${endpointLabel(entry.server, entry.port)}`}
                      onClick={() => {
                        onForget(entry);
                      }}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {forgetError === null ? null : (
              <p className="lc-error" role="alert">
                <Icon name="x-circle" size={14} />
                <span>{forgetError}</span>
              </p>
            )}
          </section>

          <section className="lc-card lc-card--side" aria-labelledby="what-h">
            <h2 id="what-h" className="lc-h3">
              What Schema Map reads
            </h2>
            <ul className="lc-reads">
              <li>
                <Icon name="database" size={17} />
                <span>
                  Reads system catalog views only, such as sys.tables and sys.foreign_keys. Never
                  your rows.
                </span>
              </li>
              <li>
                <Icon name="shield" size={17} />
                <span>
                  Needs VIEW DEFINITION, not SELECT. The check tells you exactly what is missing.
                </span>
              </li>
              <li>
                <Icon name="monitor" size={17} />
                <span>Runs on this computer. The map is a single offline file you control.</span>
              </li>
            </ul>
            <button type="button" className="lc-link lc-reads__link" onClick={onQueries}>
              See every query it runs
            </button>
          </section>
        </div>
      </div>
    </Main>
  );
}

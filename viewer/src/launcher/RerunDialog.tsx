import { useState, type SyntheticEvent } from "react";
import { Modal } from "./Modal";

interface Props {
  readonly database: string;
  /** "localhost, 14333 · SQL Server login · schemamap_reader". */
  readonly summary: string;
  readonly needsPassword: boolean;
  /** False when no remembered connection matches this map: the dialog explains and offers Connect. */
  readonly known: boolean;
  readonly onSubmit: (password: string) => void;
  /** Leave for the Connect screen, with this map's server filled in. */
  readonly onSetUp: () => void;
  readonly onClose: () => void;
}

/** Shown when nothing remembered matches the map: how to make the next re-run a password only. */
export const REMEMBER_HINT =
  "Tick “Remember this connection” next time to re-run with just a password.";

/** Re-run a saved map: Schema Map never saves passwords, so this asks for it again. */
export function RerunDialog({
  database,
  summary,
  needsPassword,
  known,
  onSubmit,
  onSetUp,
  onClose,
}: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (needsPassword && password === "") {
      setError(true);
      return;
    }
    const sent = password;
    setPassword("");
    onSubmit(sent);
  };
  return (
    <Modal titleId="rerun-h" onClose={onClose}>
      <form className="lc-modal__body" onSubmit={submit} noValidate>
        <div>
          <h2 id="rerun-h" className="lc-h2">
            Re-run {database}
          </h2>
          <p className="lc-hint">{summary}</p>
        </div>
        {known ? null : (
          <p id="rerun-remember-hint" className="lc-hint">
            {REMEMBER_HINT}
          </p>
        )}
        {known && needsPassword ? (
          <div className="lc-field">
            <label htmlFor="rerun-pw" className="lc-label">
              Password
            </label>
            <input
              id="rerun-pw"
              data-autofocus=""
              className="lc-input"
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "rerun-pw-err rerun-pw-hint" : "rerun-pw-hint"}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(false);
              }}
            />
            {error ? (
              <p id="rerun-pw-err" className="lc-error">
                Enter the password.
              </p>
            ) : null}
            <p id="rerun-pw-hint" className="lc-hint">
              Passwords are never saved, so Schema Map asks each time.
            </p>
          </div>
        ) : null}
        <div className="lc-actions lc-actions--end">
          <button type="button" className="lc-btn lc-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          {known ? (
            <button type="submit" className="lc-btn lc-btn--primary">
              Re-run extract
            </button>
          ) : (
            <button type="button" className="lc-btn lc-btn--primary" onClick={onSetUp}>
              Set up the connection
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

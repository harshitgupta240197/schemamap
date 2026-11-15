import { useState, type SyntheticEvent } from "react";
import { Modal } from "./Modal";

interface Props {
  readonly database: string;
  /** "localhost, 14333 · SQL Server login · schemamap_reader". */
  readonly summary: string;
  readonly needsPassword: boolean;
  readonly onSubmit: (password: string) => void;
  readonly onClose: () => void;
}

/** Re-run a saved map: Schema Map never saves passwords, so this asks for it again. */
export function RerunDialog({ database, summary, needsPassword, onSubmit, onClose }: Props) {
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
        {needsPassword ? (
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
          <button type="submit" className="lc-btn lc-btn--primary">
            Re-run extract
          </button>
        </div>
      </form>
    </Modal>
  );
}

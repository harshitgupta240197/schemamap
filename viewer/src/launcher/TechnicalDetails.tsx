import { useState } from "react";

/** "2026-11-15 14:03:22 UTC": the time the failure screen appeared. */
function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * A collapsed "Technical details" block for a failure: which query, what kind of error, when.
 * It takes only fixed wording from the code, never the server, user, password or connection
 * string, so a DBA can paste it into a ticket without scrubbing it.
 */
export function TechnicalDetails({
  query,
  category,
}: {
  readonly query: string;
  readonly category: string;
}) {
  const [at] = useState(() => new Date());
  return (
    <details className="lc-details">
      <summary>Technical details</summary>
      <dl className="lc-details__list">
        <dt>Query</dt>
        <dd>{query}</dd>
        <dt>Error category</dt>
        <dd>{category}</dd>
        <dt>Time</dt>
        <dd>{stamp(at)}</dd>
      </dl>
    </details>
  );
}

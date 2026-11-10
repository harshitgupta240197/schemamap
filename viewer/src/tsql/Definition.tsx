import { forwardRef, useMemo } from "react";
import { tokenize } from "./tokenize";
import "./definition.css";

/** Definitions longer than this (in UTF-16 units, about 200 KB of text) are shown unhighlighted. */
export const HIGHLIGHT_LIMIT = 200 * 1024;

/** A T-SQL definition as highlighted React elements. The text is only ever a text child. */
export const Definition = forwardRef<HTMLPreElement, { readonly text: string }>(function Definition(
  { text },
  ref,
) {
  const plainOnly = text.length > HIGHLIGHT_LIMIT;
  const tokens = useMemo(() => (plainOnly ? [] : tokenize(text)), [text, plainOnly]);
  return (
    <pre
      ref={ref}
      className="sm-sql"
      tabIndex={0}
      aria-label="Definition"
      data-highlighted={plainOnly ? "no" : "yes"}
    >
      {plainOnly
        ? text
        : tokens.map((token, i) =>
            token.kind === "plain" ? (
              token.text
            ) : (
              <span key={i} className={`sm-sql__${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
    </pre>
  );
});

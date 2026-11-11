import { useState, type RefObject } from "react";

interface CopyButtonProps {
  /** What to put on the clipboard. */
  readonly text: string;
  /** Accessible name, e.g. "Copy name". */
  readonly label: string;
  /** The element showing the text; selected for a manual copy if the Clipboard API fails. */
  readonly source: RefObject<HTMLElement | null>;
}

type CopyState = "idle" | "copied" | "manual";

function selectContents(element: HTMLElement | null): void {
  const selection = window.getSelection();
  if (element === null || selection === null) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Copies with the Clipboard API; if that is missing or refused, selects the text instead. */
export function CopyButton({ text, label, source }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const copy = (): void => {
    const done = (next: CopyState): void => {
      setState(next);
    };
    const fallback = (): void => {
      selectContents(source.current);
      done("manual");
    };
    if (typeof navigator.clipboard === "undefined") {
      fallback();
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      done("copied");
    }, fallback);
  };
  return (
    <span className="sm-copy">
      <button type="button" className="sm-copy__button" onClick={copy}>
        {label}
      </button>
      <span className="sm-copy__status" role="status">
        {state === "copied" ? "Copied" : state === "manual" ? "Press Ctrl/Cmd+C" : ""}
      </span>
    </span>
  );
}

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { searchItems, type SearchItem } from "./searchIndex";
import "./palette.css";

interface PaletteProps {
  readonly items: readonly SearchItem[];
  readonly onSelect: (item: SearchItem) => void;
  readonly onClose: () => void;
}

const KIND_LABEL = { table: "Table", view: "View", column: "Column" } as const;

/** Command palette: an ARIA combobox over tables, views and columns. Names render as text. */
export function Palette({ items, onSelect, onClose }: PaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const base = useId();
  const listId = `${base}-list`;
  const optionId = (index: number): string => `${base}-opt-${String(index)}`;
  const results = useMemo(() => searchItems(items, query), [items, query]);

  useEffect(() => {
    const before = document.activeElement;
    input.current?.focus();
    return () => {
      if (before instanceof HTMLElement) {
        before.focus();
      }
    };
  }, []);

  const move = (to: number): void => {
    if (results.length > 0) {
      setActive((to + results.length) % results.length);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(active - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = results[active];
      if (chosen !== undefined) {
        onSelect(chosen.item);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const open = results.length > 0;
  return (
    <div
      className="sm-palette__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="sm-palette" role="dialog" aria-modal="true" aria-label="Search the map">
        <input
          ref={input}
          className="sm-palette__input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? optionId(active) : undefined}
          aria-label="Search tables, views and columns"
          placeholder="Search tables, views and columns"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} className="sm-palette__list" role="listbox" aria-label="Results">
          {results.map(({ item }, index) => (
            <li
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className="sm-palette__option"
              onMouseMove={() => {
                setActive(index);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
            >
              <span className="sm-palette__kind">{KIND_LABEL[item.kind]}</span>
              <span className="sm-palette__name">{item.name}</span>
              <span className="sm-palette__context">{item.context}</span>
            </li>
          ))}
        </ul>
        <p className="sm-palette__status" role="status">
          {query.trim() === ""
            ? "Type to search. Enter focuses the table."
            : results.length === 0
              ? "No matches"
              : `${String(results.length)} results`}
        </p>
      </div>
    </div>
  );
}

/** Opens on `/` (not while typing in a field) and Ctrl+K / Cmd+K (always). */
export function useSearchShortcut(open: () => void): void {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const chord = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const slash =
        event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !typing;
      if (chord || slash) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
}

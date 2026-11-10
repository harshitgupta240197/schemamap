import { createContext, useCallback, useState } from "react";

/** Return a new set with `objectId` added if absent, removed if present. Never mutates. */
export function toggleExpanded(set: ReadonlySet<string>, objectId: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(objectId)) {
    next.delete(objectId);
  } else {
    next.add(objectId);
  }
  return next;
}

/** Which tables show all their columns, plus a toggle. */
export function useExpanded(): [ReadonlySet<string>, (objectId: string) => void] {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((objectId: string) => {
    setExpanded((current) => toggleExpanded(current, objectId));
  }, []);
  return [expanded, toggle];
}

/** Lets table nodes toggle their own expansion without putting callbacks in node data. */
export const ToggleExpandedContext = createContext<(objectId: string) => void>(() => undefined);

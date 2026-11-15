import { useSyncExternalStore } from "react";

/** What the person chose. "system" follows the OS; the default is light, whatever the OS says. */
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];
export const THEME_STORAGE_KEY = "schemamap-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The choice stored earlier, or "light" if nothing valid is stored or storage is unavailable. */
export function readStoredTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_CHOICES.find((choice) => choice === value) ?? "light";
  } catch {
    return "light";
  }
}

function storeTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage is blocked or full: the choice still applies until the page closes.
  }
}

function systemIsDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** The theme a choice shows now. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === "system") {
    return systemDark ? "dark" : "light";
  }
  return choice;
}

let current: ThemeChoice = "light";
const listeners = new Set<() => void>();

function apply(): void {
  document.documentElement.dataset["theme"] = resolveTheme(current, systemIsDark());
}

/** Read the stored choice, apply it, and follow OS changes while "system" is chosen. */
export function initTheme(): void {
  current = readStoredTheme();
  apply();
  if (typeof window.matchMedia === "function") {
    window.matchMedia(DARK_QUERY).addEventListener("change", apply);
  }
}

/** Choose a theme: apply it, remember it, and tell the switch. */
export function setTheme(choice: ThemeChoice): void {
  current = choice;
  storeTheme(choice);
  apply();
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current choice, updating when it changes. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => current);
}

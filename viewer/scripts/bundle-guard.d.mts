export const CONTEXT_CHARS: number;
export function findForbidden(html: string): string[];
export function findForbiddenWithContext(
  html: string,
): { needle: string; offset: number; context: string }[];

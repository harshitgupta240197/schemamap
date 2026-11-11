export type Direction = "left" | "right" | "up" | "down";

interface Placed {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

function centre(node: Placed): { x: number; y: number } {
  return {
    x: node.position.x + (node.width ?? 0) / 2,
    y: node.position.y + (node.height ?? 0) / 2,
  };
}

/**
 * The node to move to when an arrow key is pressed on `fromId`: the closest centre lying in that
 * direction, with sideways drift counted double so a key follows its own row or column. Ties go
 * to the lower id, so the result is stable. `null` when nothing lies that way.
 */
export function nearestInDirection(
  nodes: readonly Placed[],
  fromId: string,
  direction: Direction,
): string | null {
  const from = nodes.find((node) => node.id === fromId);
  if (from === undefined) {
    return null;
  }
  const origin = centre(from);
  let best: { id: string; score: number } | null = null;
  for (const node of nodes) {
    if (node.id === fromId) {
      continue;
    }
    const at = centre(node);
    const dx = at.x - origin.x;
    const dy = at.y - origin.y;
    const along =
      direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) {
      continue;
    }
    const score = along + 2 * across;
    if (best === null || score < best.score || (score === best.score && node.id < best.id)) {
      best = { id: node.id, score };
    }
  }
  return best === null ? null : best.id;
}

// The agent's on-screen pointer. Tools say where they act; the pointer glides
// there before the tool runs, so a viewer can follow what the agent is doing.

export type Target = Element | DOMRect | { x: number; y: number } | null | undefined;

export interface CursorState {
  visible: boolean;
  x: number;
  y: number;
  clicking: boolean;
  label: string;
}

let state: CursorState = { visible: false, x: 0, y: 0, clicking: false, label: "" };
const listeners = new Set<() => void>();
const set = (next: Partial<CursorState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const cursorStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

export const MOVE_MS = 450;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The point a target resolves to, or null if it is not on screen. */
export function pointOf(target: Target): { x: number; y: number } | null {
  if (!target) return null;
  if (target instanceof Element) {
    if (!target.isConnected) return null;
    const r = target.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + Math.min(r.width / 2, 40), y: r.top + Math.min(r.height / 2, 18) };
  }
  if ("width" in target) return { x: target.left + target.width / 2, y: target.top + target.height / 2 };
  return target;
}

/** Show the pointer at a starting point (beside the AI panel). */
export function showCursor(at: Target) {
  const p = pointOf(at) ?? { x: innerWidth - 420, y: 120 };
  set({ visible: true, x: p.x, y: p.y, clicking: false });
}

export function hideCursor() {
  set({ visible: false, clicking: false, label: "" });
}

/** Glide to `target` and press. Resolves once the motion has finished. */
export async function moveCursor(target: Target, label: string) {
  const p = pointOf(target);
  set({ visible: true, label });
  if (p) {
    set({ x: Math.max(4, Math.min(innerWidth - 4, p.x)), y: Math.max(4, Math.min(innerHeight - 4, p.y)) });
    await wait(MOVE_MS);
  }
  set({ clicking: true });
  await wait(140);
  set({ clicking: false });
}

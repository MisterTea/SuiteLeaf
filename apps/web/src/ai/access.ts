import { useLayoutEffect, useSyncExternalStore } from "react";

const restrictions = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const allowed = () => restrictions.size === 0;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** An open workspace must have edit permission before offering the assistant. */
export function useWorkspaceAiAccess(canEdit: boolean) {
  useLayoutEffect(() => {
    if (canEdit) return;
    const restriction = Symbol();
    restrictions.add(restriction);
    notify();
    return () => {
      restrictions.delete(restriction);
      notify();
    };
  }, [canEdit]);
}

export const useAiAccess = () => useSyncExternalStore(subscribe, allowed);

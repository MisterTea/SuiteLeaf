import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const EditorToolbarTarget = createContext<
  ((target: HTMLDivElement | null) => void) | null
>(null);
export const EditorToolbarNavigationTarget = createContext<
  ((target: HTMLDivElement | null) => void) | null
>(null);

export function EditorToolbarNavigationSlot() {
  const setTarget = useContext(EditorToolbarNavigationTarget);
  return setTarget ? (
    <div className="editor-toolbar-navigation" ref={setTarget} />
  ) : null;
}

/** Keeps workspace actions in the editor's toolbar, outside its read-only fieldset. */
export function EditorToolbarActionsSlot() {
  const setTarget = useContext(EditorToolbarTarget);
  return setTarget ? (
    <div className="editor-toolbar-actions" ref={setTarget} />
  ) : null;
}

export function ToolbarActions({
  target,
  children,
}: {
  target: HTMLElement | null;
  children: ReactNode;
}) {
  return target ? createPortal(children, target) : children;
}

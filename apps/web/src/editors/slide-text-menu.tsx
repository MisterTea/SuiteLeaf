import DOMPurify from "dompurify";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SlideTextMenuTarget = { editor: HTMLElement; x: number; y: number };

export function SlideTextMenu({ target, close, onError, comment, bold, italic, underline }: {
  target: SlideTextMenuTarget;
  close: () => void;
  onError: (message: string) => void;
  comment: () => void;
  bold: () => void;
  italic: () => void;
  underline: () => void;
}) {
  const [highlighted, setHighlighted] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { editor, x, y } = target;
  const doc = editor.ownerDocument;
  const hasSelection = editor instanceof HTMLTextAreaElement
    ? editor.selectionStart !== editor.selectionEnd
    : !doc.getSelection()?.isCollapsed && editor.contains(doc.getSelection()?.anchorNode ?? null);

  useLayoutEffect(() => {
    const menu = ref.current!;
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
  }, [x, y]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const navigate = (event: KeyboardEvent) => {
      if (!["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const index = items.findIndex((button) => button.dataset.highlighted === "true");
      if (event.key === "Enter" && index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") close();
      else if (event.key === "Enter") items[index].click();
      else {
        const next = event.key === "ArrowDown" ? (index + 1) % items.length
          : (index <= 0 ? items.length - 1 : index - 1);
        setHighlighted(items[next].dataset.menuLabel ?? "");
      }
    };
    doc.addEventListener("pointerdown", dismiss, true);
    doc.addEventListener("keydown", navigate, true);
    editor.addEventListener("blur", close);
    return () => {
      doc.removeEventListener("pointerdown", dismiss, true);
      doc.removeEventListener("keydown", navigate, true);
      editor.removeEventListener("blur", close);
    };
  }, [close, doc, editor]);

  const paste = async (plain: boolean) => {
    try {
      const clipboard = navigator.clipboard;
      if (!plain && !(editor instanceof HTMLTextAreaElement) && clipboard.read) {
        const items = await clipboard.read();
        const rich = items.find((item) => item.types.includes("text/html"));
        if (rich) {
          const html = await (await rich.getType("text/html")).text();
          if (doc.activeElement === editor) doc.execCommand("insertHTML", false, DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "s", "p", "div", "br", "span"],
            ALLOWED_ATTR: [],
          }));
          return;
        }
      }
      const text = await clipboard.readText();
      if (doc.activeElement === editor) doc.execCommand("insertText", false, text);
    } catch {
      onError("Clipboard access is unavailable. Use the keyboard paste shortcut.");
    }
  };

  const command = (name: string) => () => doc.execCommand(name);
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const item = (label: string, action: () => void, disabled = false, keys?: string) => (
    <button type="button" role="menuitem" className="menu-item" disabled={disabled}
      data-menu-label={label} data-highlighted={highlighted === label}
      onClick={() => { close(); action(); }}>
      <span className="menu-item-label">{label}</span>
      {keys && <span className="menu-item-keys" aria-hidden="true">{modifier}{keys}</span>}
    </button>
  );

  return createPortal(
    <div ref={ref} className="menu-content slide-context-menu slide-text-context-menu"
      role="menu" aria-label="Slide text actions" onMouseDown={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}>
      {item("Cut", command("cut"), !hasSelection, "X")}
      {item("Copy", command("copy"), !hasSelection, "C")}
      {item("Paste", () => void paste(false), false, "V")}
      {item("Paste without formatting", () => void paste(true), false, "Shift+V")}
      {item("Delete", command("delete"), !hasSelection)}
      <div role="separator" className="menu-separator" />
      {item("Comment", comment)}
      <div role="separator" className="menu-separator" />
      {item("Bold", bold, !hasSelection)}
      {item("Italic", italic, !hasSelection)}
      {item("Underline", underline, !hasSelection)}
    </div>,
    doc.body,
  );
}

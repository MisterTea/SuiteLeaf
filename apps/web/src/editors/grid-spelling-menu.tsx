import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { spellingMenuPosition, type Box } from "./grid-spelling";

export type SpellMenu = {
  key: string;
  word: string;
  suggestions: string[];
  wordBox: Box;
  cellBox: Box;
};

export function SpellContextMenu({
  menu,
  onReplace,
  onChangeAll,
  onIgnore,
  onIgnoreCell,
  onAdd,
  onClose,
}: {
  menu: SpellMenu;
  onReplace: (replacement: string) => void;
  onChangeAll: (replacement: string) => void;
  onIgnore: () => void;
  onIgnoreCell: () => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 240, height: 220 });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    setSize((current) =>
      Math.abs(current.width - width) > 1 || Math.abs(current.height - height) > 1
        ? { width, height }
        : current,
    );
  }, [menu.suggestions, menu.word]);
  const pos = spellingMenuPosition(menu.cellBox, menu.wordBox, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return (
    <div
      className="context-menu-backdrop"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="menu-content table-context-menu spelling-menu"
        role="menu"
        aria-label={`Spelling for ${menu.word}`}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
          const at = items.indexOf(document.activeElement as HTMLElement);
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const next =
              event.key === "ArrowDown"
                ? items[(at + 1) % items.length]
                : items[(at - 1 + items.length) % items.length];
            next?.focus();
          }
        }}
      >
        {menu.suggestions.length ? (
          menu.suggestions.map((suggestion, index) => (
            <Fragment key={suggestion}>
              <button
                type="button"
                role="menuitem"
                className="menu-item spelling-suggestion"
                autoFocus={index === 0}
                onClick={() => onReplace(suggestion)}
              >
                {suggestion}
              </button>
              {index === 0 ? (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => onChangeAll(suggestion)}
                >
                  Change all to {suggestion}
                </button>
              ) : null}
            </Fragment>
          ))
        ) : (
          <div className="menu-item" data-disabled="true" aria-disabled="true">
            No suggestions
          </div>
        )}
        <div className="menu-separator" role="separator" />
        <button type="button" role="menuitem" className="menu-item" onClick={onIgnore}>
          Ignore
        </button>
        <button type="button" role="menuitem" className="menu-item" onClick={onIgnoreCell}>
          Ignore this cell
        </button>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          autoFocus={menu.suggestions.length === 0}
          onClick={onAdd}
        >
          Add to dictionary
        </button>
      </div>
    </div>
  );
}

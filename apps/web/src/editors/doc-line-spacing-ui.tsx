import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Check } from "lucide-react";
import {
  LINE_SPACINGS,
  LINE_SPACING_LABEL,
  type LineSpacing,
} from "@suiteleaf/core/line-spacing";
import { selectionLineSpacing } from "./doc-line-spacing";
import { selectionParagraphSpace } from "./doc-paragraph-spacing";
import { ParagraphSpaceFields } from "./doc-paragraph-spacing-ui";

/** One control: Single, 1.15, 1.5, and Double. The closed button shows the caret's value. */
export function LineSpacingControl({ editor }: { editor: Editor | null }) {
  const current =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        currentEditor ? selectionLineSpacing(currentEditor.state) : "single",
    }) ?? "single";
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const fromKeyboard = useRef(false);
  const before =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        currentEditor ? selectionParagraphSpace(currentEditor.state, "before") : 0,
    }) ?? 0;
  const after =
    useEditorState({
      editor,
      selector: ({ editor: currentEditor }) =>
        currentEditor ? selectionParagraphSpace(currentEditor.state, "after") : 0,
    }) ?? 0;
  const points = (value: number | "mixed") => (value === "mixed" ? "mixed" : String(value));
  const label = current === "mixed" ? "Mixed" : LINE_SPACING_LABEL[current];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !fromKeyboard.current) return;
    const index = current === "mixed" ? 0 : LINE_SPACINGS.indexOf(current);
    options.current[Math.max(0, index)]?.focus();
  }, [open, current]);

  const choose = (spacing: LineSpacing) => {
    editor?.chain().focus().setLineSpacing(spacing).run();
    setOpen(false);
  };

  return (
    <div className="line-spacing-control" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="line-spacing-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "line-spacing-menu" : undefined}
        aria-label={`Line spacing, ${label}. Space before ${points(before)} points. Space after ${points(after)} points.`}
        title="Line spacing"
        disabled={!editor}
        onMouseDown={(event) => {
          event.preventDefault();
          fromKeyboard.current = false;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fromKeyboard.current = true;
            setOpen(true);
          } else if (event.key === "Escape") setOpen(false);
        }}
      >
        <span>{label}</span>
      </button>
      {open ? (
        <div className="line-spacing-menu" id="line-spacing-menu">
          <p className="line-spacing-heading">Line spacing</p>
          <div role="listbox" aria-label="Line spacing">
            {LINE_SPACINGS.map((id, index) => {
              const selected = current === id;
              return (
                <button
                  key={id}
                  ref={(node) => {
                    options.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      if (index < LINE_SPACINGS.length - 1)
                        options.current[index + 1]?.focus();
                      else
                        root.current
                          ?.querySelector<HTMLInputElement>('[aria-label="Space before"]')
                          ?.focus();
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      options.current[Math.max(0, index - 1)]?.focus();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setOpen(false);
                      trigger.current?.focus();
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(id);
                    }
                  }}
                >
                  <span className="line-spacing-mark" aria-hidden="true">
                    {selected ? <Check size={14} /> : null}
                  </span>
                  {LINE_SPACING_LABEL[id]}
                </button>
              );
            })}
          </div>
          <ParagraphSpaceFields editor={editor} before={before} after={after} />
        </div>
      ) : null}
    </div>
  );
}

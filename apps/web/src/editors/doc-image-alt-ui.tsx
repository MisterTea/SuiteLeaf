import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { X } from "lucide-react";
import {
  applyImageAlt,
  applyImageCaption,
  applyImageTurn,
  placeImageAltCard,
  selectedImage,
} from "./doc-image-alt";

/** Alt text for the selected photo, beside the image and clear of the resize handles. */
export function DocImageAlt({ editor }: { editor: Editor | null }) {
  const selection = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current?.isEditable || current.isDestroyed) return null;
      return selectedImage(current.state);
    },
  });
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [captionFor, setCaptionFor] = useState<number | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const open = selection != null && openFor === selection.pos;
  if (selection && captionFor !== selection.pos) {
    setCaptionFor(selection.pos);
    setCaptionDraft(selection.caption);
  }

  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);

  useLayoutEffect(() => {
    if (!editor || !selection || editor.isDestroyed) return;
    const update = () => {
      const rect = imageRect(editor, selection.pos);
      const card = cardRef.current;
      if (!rect || !card) return;
      const next = placeImageAltCard(
        rect,
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        selection.wrap,
        selection.inline,
      );
      setBox((prev) =>
        prev && prev.top === next.top && prev.left === next.left ? prev : next,
      );
    };
    update();
    const dom = editor.view.nodeDOM(selection.pos);
    const img = dom instanceof HTMLElement ? dom.querySelector("img") : null;
    const observed = new ResizeObserver(update);
    if (img) observed.observe(img);
    if (cardRef.current) observed.observe(cardRef.current);
    const stage = editor.view.dom.closest(".document-stage");
    stage?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    img?.addEventListener("load", update);
    return () => {
      observed.disconnect();
      stage?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      img?.removeEventListener("load", update);
    };
  }, [editor, selection, open]);

  if (!selection) return null;

  const showField = () => {
    setDraft(selection.alt);
    setOpenFor(selection.pos);
  };
  const commit = () => {
    if (!editor) return;
    applyImageAlt(editor, selection.pos, draft.trim());
    setOpenFor(null);
  };

  return createPortal(
    <div
      ref={cardRef}
      className="image-alt-card"
      style={{
        top: box?.top ?? 0,
        left: box?.left ?? 0,
        visibility: box ? "visible" : "hidden",
      }}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        const field = target.closest("textarea, input");
        if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
          if (document.activeElement !== field) {
            event.preventDefault();
            field.focus();
          }
          return;
        }
        const label = target.closest("label");
        const labeled = label?.querySelector("input, textarea");
        if (labeled instanceof HTMLInputElement || labeled instanceof HTMLTextAreaElement) {
          event.preventDefault();
          labeled.focus();
          return;
        }
        event.preventDefault();
      }}
    >
      {open ? (
        <form
          aria-label="Alt text"
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <div className="image-alt-head">
            <p className="image-alt-title">Alt text</p>
            <button
              type="button"
              className="dialog-close-btn"
              aria-label="Close alt text"
              onClick={() => setOpenFor(null)}
            >
              <X size={16} />
            </button>
          </div>
          <p id="image-alt-hint" className="image-alt-hint">
            For someone who can't see this photo. The file name is not used.
          </p>
          <textarea
            ref={fieldRef}
            aria-label="Description"
            aria-describedby="image-alt-hint"
            placeholder="What the photo shows"
            spellCheck={false}
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpenFor(null);
              } else if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commit();
              }
            }}
          />
          <div className="image-alt-actions">
            <button type="submit" className="dialog-primary-btn">
              Apply
            </button>
          </div>
        </form>
      ) : (
        <>
          <button type="button" className="image-alt-launch" onClick={showField}>
            Alt text
          </button>
          <p className={`image-alt-status${selection.alt ? "" : " is-empty"}`}>
            {selection.alt || "No description"}
          </p>
        </>
      )}
      <label className="image-caption-field">
        <span>Caption</span>
        <input
          aria-label="Caption"
          placeholder="Line under the photo"
          spellCheck={false}
          value={captionDraft}
          onChange={(event) => {
            const next = event.target.value;
            setCaptionDraft(next);
            if (editor) applyImageCaption(editor, selection.pos, next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </label>
      <p className="image-turn-angle">{selection.rotation} degrees</p>
      <div className="image-turn-row">
        <button
          type="button"
          onClick={() => editor && applyImageTurn(editor, selection.pos, "left")}
        >
          Turn left
        </button>
        <button
          type="button"
          onClick={() => editor && applyImageTurn(editor, selection.pos, "right")}
        >
          Turn right
        </button>
      </div>
    </div>,
    document.body,
  );
}

function imageRect(editor: Editor, pos: number) {
  const dom = editor.view.nodeDOM(pos);
  const root = dom instanceof HTMLElement ? dom : null;
  const img = root?.querySelector("img");
  const rect = (img ?? root)?.getBoundingClientRect();
  if (!rect || rect.width < 8 || rect.height < 8) return null;
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
  };
}

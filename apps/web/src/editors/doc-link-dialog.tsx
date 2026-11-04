import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { X } from "lucide-react";
import { linkTarget } from "./doc-links";

export type DocLink = {
  from: number;
  to: number;
  original: string;
  text: string;
  url: string;
  editing: boolean;
  error: string;
};

export function openDocLink(editor: Editor | null, setLink: Dispatch<SetStateAction<DocLink | null>>) {
  if (!editor) return;
  const editing = editor.isActive("link");
  if (editing) editor.chain().extendMarkRange("link").run();
  const { from, to } = editor.state.selection;
  const original = editor.state.doc.textBetween(from, to, "\n");
  setLink({
    from,
    to,
    original,
    text: original,
    url: editing ? String(editor.getAttributes("link").href ?? "") : "",
    editing,
    error: "",
  });
}

export function DocLinkDialog({
  editor,
  link,
  setLink,
  closeLink,
}: {
  editor: Editor;
  link: DocLink;
  setLink: Dispatch<SetStateAction<DocLink | null>>;
  closeLink: () => void;
}) {
  const applyLink = () => {
    if (!editor || !link) return;
    const href = linkTarget(link.url);
    if (!href) {
      setLink({
        ...link,
        error: "Enter a web address, an email address, or a mailto: or tel: link.",
      });
      return;
    }
    const { from, to, original } = link;
    const text = link.text || original || link.url.trim();
    const type = editor.schema.marks.link;
    const tr = editor.state.tr;
    let end = to;
    if (text !== original || from === to) {
      tr.insertText(text, from, to);
      end = from + text.length;
    }
    tr.removeMark(from, end, type).addMark(from, end, type.create({ href }));
    tr.setSelection(TextSelection.create(tr.doc, end));
    tr.setStoredMarks(tr.doc.resolve(end).marks().filter((m) => m.type !== type));
    editor.view.dispatch(tr);
    closeLink();
  };

  const removeLink = () => {
    if (!editor || !link) return;
    editor.view.dispatch(
      editor.state.tr.removeMark(link.from, link.to, editor.schema.marks.link),
    );
    closeLink();
  };

  return (
    <div className="gdocs-modal-overlay" onClick={closeLink}>
      <form
        className="gdocs-dialog insert-link-dialog"
        role="dialog"
        aria-label={link.editing ? "Edit link" : "Insert link"}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeLink();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          applyLink();
        }}
      >
        <div className="dialog-header">
          <h2>{link.editing ? "Edit link" : "Insert link"}</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close link dialog"
            onClick={closeLink}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="form-field-group">
            {link.original.includes("\n") ? null : (
              <div className="floating-field">
                <label htmlFor="doc-link-text">Text</label>
                <input
                  id="doc-link-text"
                  aria-label="Link text"
                  autoFocus={!link.original}
                  value={link.text}
                  onChange={(e) =>
                    setLink({ ...link, text: e.target.value })
                  }
                />
              </div>
            )}
            <div className="floating-field">
              <label htmlFor="doc-link-url">Link</label>
              <input
                id="doc-link-url"
                aria-label="Link address"
                aria-invalid={!!link.error}
                aria-describedby={link.error ? "doc-link-error" : undefined}
                autoFocus={!!link.original}
                placeholder="Paste a web address or email"
                value={link.url}
                onChange={(e) =>
                  setLink({ ...link, url: e.target.value, error: "" })
                }
              />
            </div>
            {link.error ? (
              <p id="doc-link-error" className="dialog-error" role="alert">
                {link.error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="dialog-footer">
          {link.editing ? (
            <button
              type="button"
              className="dialog-text-btn"
              onClick={removeLink}
            >
              Remove link
            </button>
          ) : null}
          <button
            type="button"
            className="dialog-text-btn"
            onClick={closeLink}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-primary-btn"
            disabled={!link.url.trim()}
          >
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

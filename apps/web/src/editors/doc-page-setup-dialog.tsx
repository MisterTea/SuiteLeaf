import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { X } from "lucide-react";
import {
  edgeDistancesValid,
  gutterAccepted,
  pageMarginsValid,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import { PageSetupFields } from "./page-setup";
import { pageSetupToSave } from "./doc-watermark";
import { PageSetupFit } from "./page-setup-fit";

export function DocPageSetupDialog({
  editor,
  pageDraft,
  setPageDraft,
  pageCount,
  closePageSetup,
}: {
  editor: Editor;
  pageDraft: PageSettings;
  setPageDraft: Dispatch<SetStateAction<PageSettings>>;
  pageCount: number;
  closePageSetup: () => void;
}) {
  const pageDraftValid =
    pageMarginsValid(pageDraft) &&
    edgeDistancesValid(pageDraft) &&
    gutterAccepted(pageDraft.gutter) &&
    Number.isInteger(pageDraft.pageNumberStart) &&
    pageDraft.pageNumberStart >= 1 &&
    pageDraft.pageNumberStart <= 9999;

  return (
    <div
      className="gdocs-modal-overlay page-setup-overlay"
      onClick={closePageSetup}
    >
      <form
        className="gdocs-dialog page-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Page setup"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") closePageSetup();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!pageDraftValid) return;
          editor.view.dispatch(
            editor.state.tr.setDocAttribute(
              "pageSettings",
              pageSetupToSave(pageDraft),
            ),
          );
          closePageSetup();
        }}
      >
        <div className="dialog-header">
          <h2>Page setup</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close page setup"
            onClick={closePageSetup}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body page-setup-fields">
          <div className="page-setup-basics">
            <label>
              <span>Paper size</span>
              <select
                autoFocus
                aria-label="Paper size"
                value={pageDraft.size}
                onChange={(e) =>
                  setPageDraft({
                    ...pageDraft,
                    size: e.target.value as PageSettings["size"],
                  })
                }
              >
                <option value="letter">
                  {pageDraft.landscape
                    ? "Letter (11 × 8.5 in)"
                    : "Letter (8.5 × 11 in)"}
                </option>
                <option value="a4">
                  {pageDraft.landscape ? "A4 (29.7 × 21 cm)" : "A4 (21 × 29.7 cm)"}
                </option>
              </select>
            </label>
            <fieldset className="page-setup-orientation">
              <legend>Orientation</legend>
              {(["Portrait", "Landscape"] as const).map((name) => (
                <label key={name}>
                  <input
                    type="radio"
                    name="page-orientation"
                    checked={pageDraft.landscape === (name === "Landscape")}
                    onChange={() =>
                      setPageDraft({
                        ...pageDraft,
                        landscape: name === "Landscape",
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </fieldset>
          </div>
          <PageSetupFit draft={pageDraft} onChange={setPageDraft} />
          <PageSetupFields
            draft={pageDraft}
            pageCount={pageCount}
            onChange={setPageDraft}
          />
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-text-btn"
            onClick={closePageSetup}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-primary-btn"
            disabled={!pageDraftValid}
          >
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

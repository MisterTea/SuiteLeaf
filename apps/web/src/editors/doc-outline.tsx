import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { Link } from "lucide-react";
import type { PageSettings } from "@suiteleaf/core/document-layout";
import { anchorHref } from "../anchors";
import type { HeadingPick } from "./doc-arabic-start";
import type { DocEditorState } from "./doc-toolbar";

export function useActiveHeading(
  editor: Editor | null,
  documentStage: RefObject<HTMLDivElement | null>,
  setActiveHeading: Dispatch<SetStateAction<number | null>>,
) {
  // The outline highlights the section being read: the last heading above a
  // line near the top of the window (or the first heading), as Word does.
  useEffect(() => {
    const stage = documentStage.current;
    if (!editor?.schema || !stage) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = stage.getBoundingClientRect().top + 48;
      let current: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "heading") return;
        const dom = editor.view.nodeDOM(pos);
        if (
          current === null ||
          (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= line)
        )
          current = pos;
        return false;
      });
      setActiveHeading(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    stage.addEventListener("scroll", schedule, { passive: true });
    editor.view.dom.addEventListener("suiteleaf-pages", schedule);
    editor.on("update", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener("scroll", schedule);
      editor.view.dom.removeEventListener("suiteleaf-pages", schedule);
      editor.off("update", schedule);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor's refs and setters are stable
  }, [editor]);
}

export function DocOutline({
  editor,
  state,
  activeHeading,
  jumpToHeading,
  shownSettings,
  headingPick,
  onError,
}: {
  editor: Editor;
  state: DocEditorState | null;
  activeHeading: number | null;
  jumpToHeading: (pos: number) => void;
  shownSettings: PageSettings;
  headingPick: HeadingPick | null;
  onError: (s: string) => void;
}) {
  const copyHeadingLink = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(anchorHref(slug));
    } catch {
      onError("Could not copy the link.");
    }
  };

  return (
    <aside className="outline">
      <div className="outline-header">
        <span className="outline-tab active">Outline</span>
      </div>
      {state?.headings.length ? (
        <div className="outline-list">
          {state.headings.map((h) => (
            <span
              key={h.pos}
              className={`outline-item level-${h.level}${h.pos === activeHeading ? " active" : ""}`}
            >
              <button
                type="button"
                className="outline-item-text"
                style={{ paddingLeft: 12 + (h.level - 1) * 18 }}
                aria-current={h.pos === activeHeading ? "location" : undefined}
                onClick={() => jumpToHeading(h.pos)}
              >
                {h.text || "Untitled heading"}
              </button>
              <button
                type="button"
                className="outline-link-btn"
                title={`Copy link (#${h.slug})`}
                aria-label={`Copy link to ${h.text || "heading"}`}
                onClick={() => void copyHeadingLink(h.slug)}
              >
                <Link size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="outline-empty">
          <span>Headings you add to the document will appear here.</span>
        </div>
      )}
      {shownSettings.pageNumbers &&
      shownSettings.pageNumberFormat === "roman" &&
      headingPick ? (
        <div className="arabic-start">
          <button
            type="button"
            className="arabic-start-btn"
            aria-pressed={headingPick.startArabic}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor?.chain().focus().toggleArabicNumberStart().run()}
          >
            Start Arabic numbers here
          </button>
          <p className="arabic-start-hint">{headingPick.text}</p>
        </div>
      ) : null}
    </aside>
  );
}

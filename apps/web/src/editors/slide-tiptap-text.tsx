import { Editor } from "@tiptap/core";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { SlideTextBody } from "./slide-text";
import { runsOf } from "./slide-runs";
import { slideDocumentToRuns, slideRunsToDocument } from "./slide-tiptap-model";
import { renderSlideText, slideTextKit } from "./slide-tiptap-schema";
import { registerSlideTextEditor, restoreTiptapSelection, tiptapTextSelection } from "./slide-tiptap-selection";
import "./slide-tiptap.css";

type Props = Parameters<typeof SlideTextBody>[0];

/** Static boxes have no editor, observers, plugins or React transaction subscription. */
export function TiptapSlideTextBody(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<Editor | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const emitted = useRef<string | null>(null);
  const previousCaret = useRef<{ start: number; end: number } | null>(null);
  const { kern, hang, fontFamily, fontSize, lineHeight, lineHeightPt, align, nowrap, editing } = props;
  const bold = !!props.bold, italic = !!props.italic;
  const kit = useMemo(() => slideTextKit({ kern, hang, fontFamily, fontSize, bold, italic, lineHeight, lineHeightPt, align, nowrap }),
    [kern, hang, fontFamily, fontSize, bold, italic, lineHeight, lineHeightPt, align, nowrap]);
  const signature = JSON.stringify(runsOf(props));
  const doc = useMemo(() => kit.schema.nodeFromJSON(slideRunsToDocument(JSON.parse(signature))), [kit, signature]);

  useLayoutEffect(() => {
    if (!editing) return;
    const mount = host.current!;
    mount.replaceChildren();
    const p = latest.current;
    const editor = new Editor({
      element: mount,
      extensions: kit.extensions,
      content: slideRunsToDocument(runsOf(p)),
      injectCSS: false,
      editorProps: { attributes: {
        class: "element-textarea element-editor slide-tiptap-text",
        role: "textbox", "aria-multiline": "true", "aria-label": p.placeholder || "Slide text",
        "data-placeholder": p.placeholder || "Click to add text", spellcheck: "false",
      } },
      onUpdate: ({ editor }) => {
        const runs = slideDocumentToRuns(editor.state.doc);
        emitted.current = JSON.stringify(runsOf({ runs }));
        editor.view.dom.dataset.empty = editor.state.doc.textContent ? "false" : "true";
        latest.current.onText(runs);
      },
      onSelectionUpdate: ({ editor }) => latest.current.onCaret(tiptapTextSelection(editor)),
    });
    active.current = editor;
    const unregister = registerSlideTextEditor(editor.view.dom, editor);
    editor.view.dom.dataset.empty = editor.state.doc.textContent ? "false" : "true";
    if (previousCaret.current) restoreTiptapSelection(editor, previousCaret.current.start, previousCaret.current.end);
    editor.commands.focus(previousCaret.current ? undefined : "start", { scrollIntoView: false });
    return () => {
      previousCaret.current = tiptapTextSelection(editor);
      unregister();
      active.current = null;
      editor.destroy();
      emitted.current = null;
    };
  }, [editing, kit]);

  useLayoutEffect(() => {
    const editor = active.current;
    if (editor) {
      // Local transactions already updated the view. Do not reset its caret/composition.
      if (signature === emitted.current || editor.state.doc.eq(doc) || editor.view.composing) return;
      const selection = tiptapTextSelection(editor);
      emitted.current = null;
      editor.commands.setContent(doc.toJSON(), { emitUpdate: false });
      restoreTiptapSelection(editor, selection.start, selection.end);
      return;
    }
    const root = document.createElement("div");
    root.className = "element-textarea element-editor slide-tiptap-text";
    root.contentEditable = "false";
    root.setAttribute("aria-label", props.placeholder || "Slide text");
    root.dataset.placeholder = props.placeholder || "Click to add text";
    root.dataset.empty = doc.textContent ? "false" : "true";
    root.append(renderSlideText(doc));
    host.current!.replaceChildren(root);
  }, [doc, signature, editing, props.placeholder]);

  return <div ref={host} className="slide-tiptap-mount" onMouseDown={event => {
    if (editing) event.stopPropagation();
  }} />;
}

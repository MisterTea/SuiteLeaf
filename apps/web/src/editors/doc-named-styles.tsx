import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import {
  applyCharacterStyles,
  characterStyleList,
  importCharacterStyles,
  importParagraphStyles,
  assignParagraphStyle,
  stylePatchFromMarks,
  updateNamedStyle,
  paragraphStyles,
} from "@suiteleaf/core";
import { NamedStylePanel } from "./named-style-panel";

/** The style lists live on the document node, which setContent leaves as it was. */
function writeDocument(editor: Editor, json: JSONContent) {
  const next = editor.schema.nodeFromJSON(json);
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, next.content);
  for (const [key, value] of Object.entries(next.attrs))
    if (tr.doc.attrs[key] !== value) tr.setDocAttribute(key, value);
  editor.view.dispatch(tr);
}

export function DocNamedStyles({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  return (
    <NamedStylePanel
      styles={paragraphStyles(editor.getJSON())}
      onSize={(id, fontSize) => {
        writeDocument(editor, updateNamedStyle(editor.getJSON(), id, { fontSize }));
      }}
      onMatch={(id) => {
        const selection = editor.state.selection;
        if (selection.empty) return "Select the words to match.";
        // The first selected character. Marks at a run boundary belong to the text before it.
        const first =
          editor.state.doc.nodeAt(selection.from)?.marks ?? editor.state.doc.resolve(selection.from).marks();
        const patch = stylePatchFromMarks(
          first.map((mark) => ({
            type: mark.type.name,
            attrs: mark.attrs,
          })),
        );
        if ("error" in patch) return patch.error;
        writeDocument(editor, updateNamedStyle(editor.getJSON(), id, patch));
        return "The style now matches the selection.";
      }}
      onApply={(id) => {
        const index = editor.state.selection.$from.index(0);
        writeDocument(editor, assignParagraphStyle(editor.getJSON(), index, id));
        return "That style was applied to this paragraph.";
      }}
      onImport={(template) => {
        const withParagraphs = importParagraphStyles(editor.getJSON(), template);
        writeDocument(editor, importCharacterStyles(withParagraphs, template));
      }}
      characterStyles={characterStyleList(editor.getJSON())}
      onApplyCharacter={(id) => {
        editor.chain().focus().setMark("characterStyle", { style: id }).run();
        const json = editor.getJSON();
        writeDocument(editor, applyCharacterStyles(json, characterStyleList(json)).doc);
      }}
      onClose={onClose}
    />
  );
}

import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  formatTabStop,
  parseTabStop,
  tabStopHint,
  tabStopSelection,
} from "./doc-tab-stops";

/** One number, in inches, for the left tab stop on the selected paragraphs. */
export function TabStopBar({
  editor,
  readOnly,
}: {
  editor: Editor;
  readOnly: boolean;
}) {
  const selection = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor ? tabStopSelection(editor.state) : { kind: "none" as const },
  });
  const [draft, setDraft] = useState<string | null>(null);
  const held = useRef<{ from: number; to: number } | null>(null);
  const shown =
    draft ?? (selection.kind === "set" ? formatTabStop(selection.inches) : "");
  const invalid =
    draft != null && draft.trim() !== "" && parseTabStop(draft) == null;
  const hint = tabStopHint(selection, invalid);

  const apply = (raw: string) => {
    const range = held.current ?? undefined;
    if (raw.trim() === "") {
      editor.commands.setTabStop(null, range);
      return;
    }
    const inches = parseTabStop(raw);
    if (inches == null) return;
    editor.commands.setTabStop(inches, range);
  };

  return (
    <div className="tab-stop-bar">
      <label htmlFor="doc-tab-stop">Tab stop</label>
      <input
        id="doc-tab-stop"
        aria-label="Tab stop in inches"
        aria-describedby="doc-tab-stop-hint"
        aria-invalid={invalid || undefined}
        type="number"
        inputMode="decimal"
        min={0.25}
        max={6.5}
        step={0.25}
        placeholder={selection.kind === "mixed" ? "Mixed" : "—"}
        title="Left tab stop in inches"
        disabled={readOnly || selection.kind === "none"}
        value={shown}
        onFocus={(event) => {
          held.current = {
            from: editor.state.selection.from,
            to: editor.state.selection.to,
          };
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (parseTabStop(raw) != null) apply(raw);
        }}
        onBlur={() => {
          if (draft != null) apply(draft.trim() === "" ? "" : draft);
          held.current = null;
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (draft != null) apply(draft.trim() === "" ? "" : draft);
          setDraft(null);
          event.currentTarget.blur();
        }}
      />
      <span className="tab-stop-unit">in</span>
      <span id="doc-tab-stop-hint" className="tab-stop-hint">
        {hint}
      </span>
    </div>
  );
}

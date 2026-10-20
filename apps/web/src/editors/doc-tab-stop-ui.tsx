import { useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { parseTabStop, TAB_STOP_MAX, TAB_STOP_MIN } from "./doc-tab-stops";

function paragraphStops(
  editor: Editor,
  range: { from: number; to: number } | null,
): number[] {
  const from = range?.from ?? editor.state.selection.from;
  const to = range?.to ?? editor.state.selection.to;
  const stops: number[] = [];
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name !== "paragraph") return;
    const inches = parseTabStop(node.attrs.tabStop);
    if (inches != null) stops.push(inches);
    return false;
  });
  return stops;
}

function hintFor(stops: number[]): string {
  if (stops.length === 0) return "";
  const unique = new Set(stops);
  if (unique.size !== 1) return "";
  const inches = stops[0];
  return stops.length === 1
    ? `This line has a stop at ${inches} in.`
    : `These ${stops.length} lines share a stop at ${inches} in.`;
}

/** One left tab stop for the selected lines. Inches, not a ruler. */
export function TabStopField({ editor }: { editor: Editor | null }) {
  const range = useRef<{ from: number; to: number } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const stored = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return [] as number[];
      return paragraphStops(current, range.current);
    },
  }) ?? [];
  const shared = new Set(stored).size === 1 ? String(stored[0]) : "";
  const shown = draft ?? shared;

  const apply = (raw: string) => {
    if (!editor) return;
    const inches = parseTabStop(raw);
    if (inches == null) return;
    editor.commands.setTabStop(inches, range.current ?? undefined);
  };

  return (
    <label className="tab-stop-field">
      <span className="tab-stop-label">Tab stop</span>
      <input
        type="number"
        aria-label="Tab stop in inches"
        aria-describedby="doc-tab-stop-hint"
        inputMode="decimal"
        min={TAB_STOP_MIN}
        max={TAB_STOP_MAX}
        step={0.25}
        value={shown}
        disabled={!editor}
        onMouseDown={() => {
          if (!editor) return;
          const selection = editor.state.selection;
          range.current = { from: selection.from, to: selection.to };
        }}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          apply(next);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          apply(event.currentTarget.value);
          setDraft(null);
        }}
        onBlur={() => setDraft(null)}
      />
      <span id="doc-tab-stop-hint">{hintFor(stored)}</span>
    </label>
  );
}

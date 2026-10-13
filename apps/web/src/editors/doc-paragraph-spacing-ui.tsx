import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { parseParagraphSpace } from "@suiteleaf/core/paragraph-spacing";
import "./doc-paragraph-spacing.css";

function SpaceField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | "mixed";
  disabled: boolean;
  onCommit: (points: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === "mixed" ? "" : String(value));

  useEffect(() => {
    if (value !== "mixed" && draft === String(value)) setDraft(null);
  }, [draft, value]);

  const commit = (raw: string) => {
    const parsed = parseParagraphSpace(raw);
    if (parsed === null) {
      setDraft(null);
      return;
    }
    if (parsed === value) {
      setDraft(null);
      return;
    }
    setDraft(String(parsed));
    onCommit(parsed);
  };

  return (
    <label className="paragraph-space-field">
      <span>{label}</span>
      <input
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        title="0 to 250 points. 0 removes the gap."
        disabled={disabled}
        placeholder={value === "mixed" ? "Mixed" : "0"}
        value={shown}
        onMouseDown={(event) => {
          event.preventDefault();
          const input = event.currentTarget;
          input.focus();
          requestAnimationFrame(() => input.select());
        }}
        onFocus={(event) => {
          setDraft((current) => current ?? (value === "mixed" ? "" : String(value)));
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit(event.currentTarget.value);
        }}
      />
      <span className="paragraph-space-unit">pt</span>
    </label>
  );
}

/** Space before and space after, on the line-spacing control. Points, not a second dialog. */
export function ParagraphSpaceFields({
  editor,
  before,
  after,
}: {
  editor: Editor | null;
  before: number | "mixed";
  after: number | "mixed";
}) {
  const apply = (side: "before" | "after", points: number) => {
    if (!editor) return;
    const command =
      side === "before"
        ? editor.commands.setParagraphSpaceBefore
        : editor.commands.setParagraphSpaceAfter;
    command(points);
  };

  return (
    <div className="paragraph-space-fields" role="group" aria-label="Space before and after">
      <p className="line-spacing-heading">Paragraph spacing</p>
      <SpaceField
        label="Space before"
        value={before}
        disabled={!editor}
        onCommit={(points) => apply("before", points)}
      />
      <SpaceField
        label="Space after"
        value={after}
        disabled={!editor}
        onCommit={(points) => apply("after", points)}
      />
      <p className="paragraph-space-hint">Points. 0 removes the gap. Line spacing stays.</p>
    </div>
  );
}

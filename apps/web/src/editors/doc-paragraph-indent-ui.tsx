import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Check } from "lucide-react";
import {
  PARAGRAPH_INDENT_DEFAULT_IN,
  parseIndentInches,
  type SpecialIndent,
} from "@suiteleaf/core/paragraph-indent";
import "./doc-paragraph-indent.css";

const CHOICES: { id: SpecialIndent; label: string }[] = [
  { id: "none", label: "None" },
  { id: "firstLine", label: "First line" },
  { id: "hanging", label: "Hanging" },
];

/** First line and hanging, on the line-spacing control. Inches, not a second dialog. */
export function ParagraphIndentFields({
  editor,
  kind,
  inches,
}: {
  editor: Editor | null;
  kind: SpecialIndent | "mixed";
  inches: number | "mixed";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending =
    inches === "mixed"
      ? ""
      : kind === "none"
        ? String(PARAGRAPH_INDENT_DEFAULT_IN)
        : String(inches);
  const shown = draft ?? pending;

  useEffect(() => {
    setDraft(null);
  }, [kind, inches]);

  const apply = (next: SpecialIndent, raw: string) => {
    if (!editor) return;
    const parsed = parseIndentInches(raw);
    const amount = parsed === null ? PARAGRAPH_INDENT_DEFAULT_IN : parsed;
    if (next === "none" || amount === 0)
      editor.commands.setSpecialIndent("none", 0);
    else editor.commands.setSpecialIndent(next, amount);
  };

  const commitAmount = (raw: string) => {
    const parsed = parseIndentInches(raw);
    if (parsed === null) {
      setDraft(null);
      return;
    }
    if (kind === "firstLine" || kind === "hanging") {
      apply(parsed === 0 ? "none" : kind, raw);
      setDraft(null);
      return;
    }
    setDraft(parsed === 0 ? null : String(parsed));
  };

  return (
    <div
      className="paragraph-indent-fields"
      role="group"
      aria-label="Special indent"
    >
      <p className="line-spacing-heading">Special indent</p>
      <div role="listbox" aria-label="Special indent">
        {CHOICES.map((choice) => {
          const selected = kind === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={!editor}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(choice.id, shown)}
            >
              <span className="line-spacing-mark" aria-hidden="true">
                {selected ? <Check size={14} /> : null}
              </span>
              {choice.label}
            </button>
          );
        })}
      </div>
      <label className="paragraph-space-field">
        <span>By</span>
        <input
          aria-label="Indent by"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          title="0 to 6 inches. 0 removes the indent."
          disabled={!editor}
          placeholder={inches === "mixed" ? "Mixed" : "0.5"}
          value={shown}
          onMouseDown={(event) => {
            event.preventDefault();
            const input = event.currentTarget;
            input.focus();
            requestAnimationFrame(() => input.select());
          }}
          onFocus={(event) => {
            setDraft((current) => current ?? shown);
            event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commitAmount(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitAmount(event.currentTarget.value);
          }}
        />
        <span className="paragraph-space-unit">in</span>
      </label>
      <p className="paragraph-indent-hint">
        Inches. 0 or None removes it. Line spacing stays.
      </p>
    </div>
  );
}

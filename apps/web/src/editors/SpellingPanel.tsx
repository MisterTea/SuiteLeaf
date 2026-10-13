import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { X } from "lucide-react";
import { findMisspellings, spellchecker, type Misspelling } from "./doc-spelling";

/** Tools › Spelling and grammar: misspelled words with suggestions. */
export default function SpellingPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [found, setFound] = useState<Misspelling[] | null>(null);
  const [ignored] = useState(() => new Set<string>());
  const [, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = () =>
      void spellchecker().then((spell) => {
        if (alive) setFound(findMisspellings(editor.state.doc, spell, ignored));
      });
    check();
    editor.on("update", check);
    return () => {
      alive = false;
      editor.off("update", check);
    };
  }, [editor, ignored]);
  const show = (m: Misspelling) =>
    editor.chain().focus().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
  const change = (m: Misspelling, word: string) =>
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, word).run();
  const unique = found
    ? [...new Map(found.map((m) => [m.word.toLowerCase(), m])).values()]
    : [];
  return (
    <aside className="spelling-panel" aria-label="Spelling and grammar">
      <header>
        <h2>Spelling</h2>
        <button className="dialog-close-btn" aria-label="Close spelling" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {found === null ? (
        <p className="spelling-status">Checking…</p>
      ) : unique.length === 0 ? (
        <p className="spelling-status">No spelling mistakes found.</p>
      ) : (
        <>
          <p className="spelling-status">
            {found.length} {found.length === 1 ? "word" : "words"} to check
          </p>
          <ul>
            {unique.map((m) => (
              <li key={m.word.toLowerCase()} className="spelling-item">
                <button className="spelling-word" onClick={() => show(m)}>
                  {m.word}
                  <small>{found.filter((f) => f.word.toLowerCase() === m.word.toLowerCase()).length}×</small>
                </button>
                <span className="spelling-suggestions">
                  {m.suggestions.map((s) => (
                    <button key={s} onClick={() => change(m, s)} aria-label={`Change ${m.word} to ${s}`}>
                      {s}
                    </button>
                  ))}
                  <button
                    className="spelling-ignore"
                    onClick={() => {
                      ignored.add(m.word.toLowerCase());
                      setFound(found.filter((f) => f.word.toLowerCase() !== m.word.toLowerCase()));
                      setRevision((r) => r + 1);
                    }}
                  >
                    Ignore
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

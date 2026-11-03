import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { indexMarkAttrs } from "./index-entry";

/** Writes an index mark on the selection. The status line does not repeat the words. */
export function IndexEntryPanel({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  const [subentry, setSubentry] = useState("");
  const [see, setSee] = useState("");
  const [seeAlso, setSeeAlso] = useState("");
  const [notice, setNotice] = useState("");
  const mark = () => {
    if (editor.state.selection.empty) {
      setNotice("Select the words to mark.");
      return;
    }
    const result = indexMarkAttrs(term, see, subentry, seeAlso);
    if (!result.ok) {
      setNotice(result.notice);
      return;
    }
    const wrote = editor.chain().focus().setMark("index", result.attrs).run();
    setNotice(wrote ? "The index entry was marked." : "The index entry was not marked.");
  };
  return (
    <div className="gdocs-dialog" role="dialog" aria-label="Index entry">
      <label>
        Term
        <input aria-label="Index term" value={term} onChange={(event) => setTerm(event.target.value)} />
      </label>
      <label>
        Subentry
        <input aria-label="Index subentry" value={subentry} onChange={(event) => setSubentry(event.target.value)} />
      </label>
      <label>
        See
        <input aria-label="See another term" value={see} onChange={(event) => setSee(event.target.value)} />
      </label>
      <label>
        See also
        <input aria-label="See also another term" value={seeAlso} onChange={(event) => setSeeAlso(event.target.value)} />
      </label>
      {notice ? <p role="status">{notice}</p> : null}
      <button type="button" onClick={mark}>
        Mark index entry
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

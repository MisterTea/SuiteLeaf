import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { X } from "lucide-react";
import {
  citationLibrary,
  createSource,
  inText,
  type CitationStyle,
  type SourceKind,
} from "@suiteleaf/core/citations";

const STYLES: { id: CitationStyle; label: string }[] = [
  { id: "apa", label: "APA" },
  { id: "mla", label: "MLA" },
  { id: "chicago", label: "Chicago" },
];

export function DocCitations({
  editor,
  open,
  onOpen,
  readOnly,
}: {
  editor: Editor;
  open: boolean;
  onOpen: (open: boolean) => void;
  readOnly: boolean;
}) {
  const library = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      citationLibrary({ attrs: current.state.doc.attrs }),
  });
  const citedKey = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const ids: string[] = [];
      current.state.doc.descendants((node) => {
        if (node.type.name === "citation")
          ids.push(String(node.attrs.sourceId ?? ""));
      });
      return ids.join("\0");
    },
  });
  const cited = new Set(citedKey.split("\0").filter(Boolean));
  const selectedId = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const selection = current.state.selection;
      return selection instanceof NodeSelection &&
        selection.node.type.name === "citation"
        ? String(selection.node.attrs.sourceId ?? "")
        : "";
    },
  });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<SourceKind>("book");
  const [author, setAuthor] = useState("");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [page, setPage] = useState("");
  const [error, setError] = useState("");
  const authorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    editor.storage.citationLibrary.openPanel = () => onOpen(true);
    return () => {
      editor.storage.citationLibrary.openPanel = () => {};
    };
  }, [editor, onOpen]);

  useEffect(() => {
    if (!open || !selectedId) return;
    document
      .getElementById(`citation-source-${selectedId}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, selectedId, library.sources]);

  useEffect(() => {
    if (adding) authorRef.current?.focus();
  }, [adding]);

  const setStyle = (style: CitationStyle) => {
    editor.view.dispatch(editor.state.tr.setDocAttribute("citationStyle", style));
  };
  const setSources = (
    sources: typeof library.sources,
  ) => {
    editor.view.dispatch(
      editor.state.tr.setDocAttribute("citationSources", sources),
    );
  };
  const addSource = () => {
    if (!author.trim() || !title.trim() || !year.trim()) {
      setError("Add the author, title, and year.");
      return;
    }
    const source = createSource(
      { kind, author, title, year, page },
      library.sources,
    );
    setSources([...library.sources, source]);
    setAuthor("");
    setTitle("");
    setYear("");
    setPage("");
    setError("");
    setAdding(false);
    setKind("book");
  };
  const updateYear = (id: string, next: string) => {
    setSources(
      library.sources.map((source) =>
        source.id === id ? { ...source, year: next } : source,
      ),
    );
  };
  const removeSource = (id: string) => {
    const { tr } = editor.state;
    const spots: { from: number; to: number }[] = [];
    tr.doc.descendants((node, pos) => {
      if (node.type.name === "citation" && node.attrs.sourceId === id)
        spots.push({ from: pos, to: pos + node.nodeSize });
    });
    for (const spot of spots.reverse()) tr.delete(spot.from, spot.to);
    tr.setDocAttribute(
      "citationSources",
      library.sources.filter((source) => source.id !== id),
    );
    editor.view.dispatch(tr);
  };

  return (
    <aside
      className="doc-citations-panel"
      aria-label="Citations"
      hidden={!open}
    >
      <div className="doc-citations-head">
        <h2>Citations</h2>
        <button
          type="button"
          className="doc-citations-icon"
          aria-label="Close citations"
          onClick={() => onOpen(false)}
        >
          <X size={16} />
        </button>
      </div>
      <div className="doc-citations-scroll">
        <div className="doc-citations-styles" role="radiogroup" aria-label="Citation style">
          {STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={library.style === style.id}
              className={library.style === style.id ? "is-selected" : ""}
              disabled={readOnly}
              onClick={() => setStyle(style.id)}
            >
              {style.label}
            </button>
          ))}
        </div>
        <p className="doc-citations-hint">
          Citations and the bibliography follow the source. Change a year and both update. No refresh.
        </p>
        {adding ? (
          <form
            className="doc-citations-form"
            onSubmit={(event) => {
              event.preventDefault();
              addSource();
            }}
          >
            <div className="doc-citations-kinds" role="group" aria-label="Source type">
              {(["book", "article"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  className={kind === value ? "is-selected" : ""}
                  onClick={() => setKind(value)}
                >
                  {value === "book" ? "Book" : "Article"}
                </button>
              ))}
            </div>
            <label>
              Author
              <input
                ref={authorRef}
                aria-label="Author"
                autoComplete="off"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
              />
            </label>
            <label>
              Title
              <input
                aria-label="Title"
                autoComplete="off"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Year
              <input
                aria-label="Year"
                autoComplete="off"
                inputMode="numeric"
                value={year}
                onChange={(event) => setYear(event.target.value)}
              />
            </label>
            <label>
              Page
              <input
                aria-label="Page"
                autoComplete="off"
                placeholder="Optional. Leave blank for no page."
                value={page}
                onChange={(event) => setPage(event.target.value)}
              />
            </label>
            {error ? (
              <p className="doc-citations-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="doc-citations-form-actions">
              <button type="submit" className="doc-citations-primary">
                Add source
              </button>
              <button
                type="button"
                className="doc-citations-quiet"
                onClick={() => {
                  setAdding(false);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="doc-citations-primary"
            disabled={readOnly}
            onClick={() => setAdding(true)}
          >
            Add citation source
          </button>
        )}
        {library.sources.length ? (
          <ul className="doc-citations-list">
            {library.sources.map((source) => {
              const isCited = cited.has(source.id);
              return (
                <li
                  key={source.id}
                  id={`citation-source-${source.id}`}
                  className={`doc-citation-source${selectedId === source.id ? " is-selected" : ""}`}
                  aria-current={selectedId === source.id ? "true" : undefined}
                >
                  <div className="doc-citation-source-top">
                    <strong>{source.author}</strong>
                    <button
                      type="button"
                      className="doc-citations-cite"
                      aria-label={`Cite ${source.author}`}
                      disabled={readOnly}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => editor.commands.insertCitation(source.id)}
                    >
                      Cite
                    </button>
                  </div>
                  <p>{source.title}</p>
                  <p className="doc-citation-meta">
                    {source.kind === "book" ? "Book" : "Article"}
                    {" · "}
                    {inText(source, library.style)}
                  </p>
                  <label className="doc-citation-year">
                    Year
                    <input
                      aria-label={`Year for ${source.author}`}
                      value={source.year}
                      disabled={readOnly}
                      onChange={(event) => updateYear(source.id, event.target.value)}
                    />
                  </label>
                  <div className="doc-citation-source-foot">
                    <span>{isCited ? "Cited" : "Not cited"}</span>
                    <button
                      type="button"
                      className="doc-citations-quiet"
                      disabled={readOnly}
                      onClick={() => removeSource(source.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : adding ? null : (
          <p className="doc-citations-empty">
            No sources yet. Add a book or an article, then cite it in the text.
          </p>
        )}
      </div>
      <div className="doc-citations-footer">
        <button
          type="button"
          className="doc-citations-primary"
          disabled={readOnly}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.chain().focus().insertBibliography().run()}
        >
          Insert bibliography
        </button>
        <p className="doc-citations-hint">
          Only sources you cite are listed. A source you never cite stays out.
        </p>
      </div>
    </aside>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  latexMathML,
  officeMathLatex,
  type SlideElement,
  type TextRun,
} from "@suiteleaf/core";

export function hasSlideEquation(element: SlideElement): boolean {
  return (
    !!element.math ||
    !!element.runs?.some((run) => run.math || run.latex || run.officeMath)
  );
}

export function slideEquations(element: SlideElement) {
  if (element.math)
    return [{ index: 0, count: 0, source: element.content ?? "" }];
  const equations: { index: number; count: number; source: string }[] = [];
  const runs = element.runs ?? [];
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    if (run.latex) equations.push({ index, count: 1, source: run.latex });
    else if (run.officeMath) {
      const { xml, count } = run.officeMath;
      let source = run.text;
      try {
        source = officeMathLatex(xml) || source;
      } catch {
        /* Use recovered equation text. */
      }
      equations.push({ index, count, source });
      index += count - 1;
    } else if (run.math) {
      const f = run.fraction;
      const parts = (p: NonNullable<TextRun["fraction"]>["num"]) =>
        p
          .map(({ text, script }) =>
            script ? (script === "sub" ? "_{" : "^{") + text + "}" : text,
          )
          .join("");
      const source = f
        ? f.bar === false
          ? "\\underset{" + parts(f.den) + "}{" + parts(f.num) + "}"
          : "\\frac{" + parts(f.num) + "}{" + parts(f.den) + "}"
        : run.text;
      equations.push({ index, count: 1, source });
    }
  }
  return equations;
}

export function equationRun(source: string, prior?: TextRun): TextRun {
  const {
    officeMath: _office,
    fraction: _fraction,
    baseline: _baseline,
    scriptScale: _scale,
    scriptStrut: _strut,
    ...style
  } = prior ?? { text: "" };
  return {
    ...style,
    text: source.replace(/[\r\n]+/g, " "),
    math: true,
    latex: source,
  };
}

export function SlideEquationDialog({
  equations,
  onClose,
  onSave,
}: {
  equations: ReturnType<typeof slideEquations>;
  onClose: () => void;
  onSave: (source: string, equation: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState(equations[0]?.source ?? "");
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = modal.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, []);
  let preview = "";
  let error = "";
  if (source.trim()) {
    try {
      preview = latexMathML(source);
    } catch {
      error = "This LaTeX equation could not be parsed.";
    }
  }
  return (
    <dialog
      className="gdocs-dialog equation-dialog slide-equation-dialog"
      ref={modal}
      aria-label="Slide equation"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (preview) onSave(source.trim(), index);
        }}
      >
        <div className="dialog-header">
          <h2>{equations.length ? "Edit equation" : "Insert equation"}</h2>
        </div>
        <div className="dialog-body">
          {equations.length > 1 && (
            <label>
              Equation
              <select
                value={index}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setIndex(next);
                  setSource(equations[next].source);
                }}
              >
                {equations.map((_, i) => (
                  <option key={i} value={i}>
                    Equation {i + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="equation-field">
            LaTeX
            <textarea
              autoFocus
              value={source}
              maxLength={4096}
              spellCheck={false}
              placeholder="\\frac{x^2}{1+x}"
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div
            className="equation-preview"
            aria-label="Equation preview"
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!preview}>
            {equations.length ? "Apply" : "Insert"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

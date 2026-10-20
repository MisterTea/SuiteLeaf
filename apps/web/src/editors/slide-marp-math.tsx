import { useMemo } from "react";
import katex from "katex";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import "katex/dist/katex.min.css";

hljs.registerLanguage("python", python);

/** Colored code. A click on the box replaces this with the plain source. */
export function MarpCode({ source, language }: { source: string; language?: string }) {
  const html = useMemo(() => {
    const known = language && hljs.getLanguage(language) ? language : "python";
    try {
      return hljs.highlight(source, { language: known }).value;
    } catch {
      return source
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [source, language]);
  return <pre className="marp-code" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A sentence with `$...$` or `$$...$$` in it. A click replaces this with the source. */
export function MarpRichText({ source }: { source: string }) {
  const parts = source.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return (
    <div className="marp-rich">
      {parts.map((part, index) => {
        if (part.startsWith("$$")) return <MarpMath key={index} source={part} />;
        if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
          const tex = part.slice(1, -1);
          let html = "";
          try {
            html = katex.renderToString(tex, {
              displayMode: false,
              throwOnError: false,
              output: "html",
            });
          } catch {
            html = "";
          }
          if (!html) return <span key={index}>{part}</span>;
          return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        return <span key={index}>{part}</span>;
      })}
    </div>
  );
}

/** Typeset LaTeX. A click on the box replaces this with the source for editing. */
export function MarpMath({ source }: { source: string }) {
  const html = useMemo(() => {
    const tex = source
      .replace(/^\s*\$\$\s*/, "")
      .replace(/\s*\$\$\s*$/, "")
      .trim();
    try {
      return katex.renderToString(tex, {
        displayMode: true,
        throwOnError: false,
        output: "html",
      });
    } catch {
      return "";
    }
  }, [source]);
  if (!html) return <pre className="element-textarea">{source}</pre>;
  return <div className="marp-math" dangerouslySetInnerHTML={{ __html: html }} />;
}

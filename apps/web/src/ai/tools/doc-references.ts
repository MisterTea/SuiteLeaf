import type { Editor } from "@tiptap/core";
import { Type } from "@earendil-works/pi-ai";
import {
  bibliographyPlain,
  citationLibrary,
  createSource,
  inText,
  type CitationSource,
  type CitationStyle,
  type SourceKind,
} from "@suiteleaf/core/citations";
import "../../editors/doc-citations";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import {
  wait,
  blocks,
  loose,
  findBlock,
  noBlock,
  locate,
  rectAt,
  headingNamesNow,
} from "./doc-blocks";

function libraryOf(editor: Editor) {
  return citationLibrary({ attrs: editor.state.doc.attrs });
}

function saveLibrary(editor: Editor, sources: CitationSource[], style: CitationStyle) {
  const tr = editor.state.tr;
  tr.setDocAttribute("citationStyle", style);
  tr.setDocAttribute("citationSources", sources);
  editor.view.dispatch(tr);
}

function cleanLabel(value: unknown) {
  return String(value ?? "")
    .replace(/^[\s"'“”]+|[\s"'“”.,:;]+$/g, "")
    .trim();
}

function cleanYear(value: unknown) {
  const text = String(value ?? "");
  return text.match(/\d{4}/)?.[0] ?? text.replace(/[^\d]/g, "").trim();
}

function cleanKind(value: unknown): SourceKind {
  return /article|journal|paper|magazine/i.test(String(value ?? "")) ? "article" : "book";
}

function sourceNamed(sources: CitationSource[], author: string) {
  const want = loose(cleanLabel(author));
  return (
    sources.find((source) => loose(source.author) === want) ??
    sources.find((source) => loose(source.author).includes(want) || want.includes(loose(source.author)))
  );
}

function sourceList(editor: Editor) {
  const library = libraryOf(editor);
  if (!library.sources.length) return "No sources yet.";
  return library.sources
    .map((source) => `${source.author}, "${source.title}", ${source.year}, ${source.kind}, ${inText(source, library.style)}`)
    .join("; ");
}

function citedLines(editor: Editor) {
  const library = libraryOf(editor);
  const lines: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "citation") return;
    const source = library.sources.find((item) => item.id === String(node.attrs.sourceId ?? ""));
    lines.push(source ? inText(source, library.style) : "(missing source)");
  });
  return lines;
}

function paragraphEnd(editor: Editor, raw: string) {
  const match = locate(editor, raw);
  const $pos = editor.state.doc.resolve(match.from);
  for (let depth = $pos.depth; depth > 0; depth--)
    if ($pos.node(depth).type.name === "note")
      throw new ToolError(`"${raw}" is inside a footnote. Choose words in the report.`);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.isTextblock) return { at: $pos.end(depth), node };
  }
  throw new ToolError(`"${raw}" is not in a paragraph.`);
}

/** Footnote sources in reading order, "1. text". */
function footnoteReport(editor: Editor) {
  const notes = new Map<string, string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "note") notes.set(String(node.attrs.id), node.textContent.trim());
  });
  const lines: string[] = [];
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "note") return false;
    if (node.type.name !== "noteReference" || node.attrs.kind === "endnote") return;
    n += 1;
    lines.push(`${n}. ${notes.get(String(node.attrs.id)) ?? ""}`);
  });
  return lines;
}

export function docReferenceTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  return [
    tool({
      name: "insert_table_of_contents",
      label: "Table of contents",
      description:
        "Insert a table of contents that lists every heading and updates itself when headings are renamed, added, or moved. page_numbers true (the default) shows page numbers. before is the paragraph to put it in front of. On page 2, before is \"Start of the report\". Do not type the contents as text.",
      parameters: Type.Object({
        before: Type.Optional(Type.String({ description: "Paragraph the table should come before, such as Start of the report." })),
        page_numbers: Type.Optional(Type.Boolean({ description: "True shows page numbers. Default true." })),
      }),
      prepare(args) {
        let page_numbers = args.page_numbers ?? args.pageNumbers ?? true;
        if (typeof page_numbers === "string") page_numbers = !/false|plain|link|off|no/i.test(page_numbers);
        return { before: String(args.before ?? args.at ?? ""), page_numbers: Boolean(page_numbers) };
      },
      target: ({ before }) => {
        const block = findBlock(blocks(editor), before?.trim() || "Start of the report");
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      async execute({ before = "", page_numbers = true }) {
        let has = false;
        editor.state.doc.descendants((node) => {
          if (node.type.name === "tableOfContents") has = true;
        });
        if (has) return `A table of contents is already in the document. It lists: ${headingNamesNow(editor)}. It updates on its own.`;
        let anchor = before.trim();
        if (!anchor && blocks(editor).some((b) => b.text.trim() === "Start of the report")) anchor = "Start of the report";
        if (!anchor) throw new ToolError('Say which paragraph the table of contents should come before. On page 2 that is "Start of the report".');
        const block = findBlock(blocks(editor), anchor);
        if (!block) throw noBlock(blocks(editor), anchor);
        editor.chain().focus().setTextSelection(block.pos + 1).run();
        const ok = editor.commands.insertTableOfContents(page_numbers !== false);
        if (!ok) throw new ToolError(`Could not insert a table of contents before "${block.text}".`);
        await wait(400);
        return `Inserted a table of contents${page_numbers !== false ? " with page numbers" : ""} before "${block.text}". It lists: ${headingNamesNow(editor)}.`;
      },
    }),
    tool({
      name: "insert_footnote",
      label: "Footnote",
      description:
        "Insert one footnote at the end of the paragraph that contains `after`, and type `text` as the source. The number follows reading order; do not type a superscript. Call once per note. After \"attendance rose 40%\" the source is the Saturday league return. After \"The charity coaches\" the source is \"Charity registration.\" After \"The secondary school lends\" the source is \"Pitch agreement.\" After \"We want a second pitch\" the source is \"Club development plan.\"",
      parameters: Type.Object({
        after: Type.String({ description: "Words in the paragraph the note belongs to, such as attendance rose 40%." }),
        text: Type.String({ description: "The source typed into the footnote." }),
      }),
      prepare(args) {
        return {
          after: String(args.after ?? args.phrase ?? args.at ?? "").trim(),
          text: String(args.text ?? args.note ?? args.source ?? args.body ?? "").trim(),
        };
      },
      target: ({ after }) => {
        try {
          return rectAt(editor, locate(editor, after).to);
        } catch {
          return editor.view.dom;
        }
      },
      async execute({ after, text }) {
        const source = text.trim();
        if (!after.trim()) throw new ToolError("Say which words the footnote follows.");
        if (!source) throw new ToolError("Say the source text to type into the footnote.");
        const existing = footnoteReport(editor);
        const already = existing.find((line) => loose(line).includes(loose(source.slice(0, 24))));
        if (already) return `That footnote is already in the document. Footnotes in reading order: ${existing.join(" | ")}.`;
        const match = locate(editor, after);
        const $pos = editor.state.doc.resolve(match.from);
        for (let depth = $pos.depth; depth > 0; depth--)
          if ($pos.node(depth).type.name === "note")
            throw new ToolError(`"${after}" is inside a footnote. Choose words in the report.`);
        const at = $pos.end();
        editor.chain().focus().setTextSelection(at).run();
        const ok = editor.commands.insertFootnote();
        if (!ok) throw new ToolError(`Could not add a footnote after "${after}".`);
        let notePos = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "note" && node.attrs.kind !== "endnote" && !node.textContent.trim()) notePos = pos;
        });
        if (notePos < 0) throw new ToolError("The footnote marker was added but its note did not open.");
        editor.chain().focus().setTextSelection(notePos + 2).insertContent({ type: "text", text: source }).run();
        const note = editor.state.doc.nodeAt(notePos);
        if (note?.type.name === "note" && !loose(note.textContent).includes(loose(source.slice(0, 24)))) {
          const para = editor.schema.nodes.paragraph.create({}, editor.schema.text(source));
          editor.view.dispatch(editor.state.tr.replaceWith(notePos + 1, notePos + note.nodeSize - 1, para));
        }
        await wait(300);
        const lines = footnoteReport(editor);
        return `Added a footnote at the end of the paragraph containing "${after}". Footnotes in reading order: ${lines.join(" | ")}.`;
      },
    }),
    tool({
      name: "add_source",
      label: "Add source",
      description:
        "Add one APA citation source. Call once per source. Do not type the source into the document, and leave the page blank. For Grant report 2026 call it three times: Mensah, book, title Youth football in Accra, year 2024; Boateng, article, title Coaching hours, year 2023; Adu, book, title Unused notes, year 2020. Unused notes is added and never cited.",
      parameters: Type.Object({
        author: Type.String({ description: "Author, such as Mensah, Boateng, or Adu." }),
        title: Type.String({ description: "Title, such as Youth football in Accra." }),
        year: Type.String({ description: "Year the source was published. Mensah starts as 2024." }),
        kind: Type.String({ description: "book or article. Mensah and Adu are books. Boateng is an article." }),
      }),
      prepare(args) {
        return {
          author: cleanLabel(args.author ?? args.name),
          title: cleanLabel(args.title ?? args.work),
          year: cleanYear(args.year),
          kind: cleanKind(args.kind ?? args.type ?? args.source_type),
        };
      },
      target: () => editor.view.dom,
      execute({ author, title, year, kind }) {
        if (!author || !title || !year)
          throw new ToolError("Give one source's author, title, and year. Add Mensah, Boateng, and Adu in separate calls.");
        const library = libraryOf(editor);
        const existing = library.sources.find(
          (source) => loose(source.author) === loose(author) && loose(source.title) === loose(title),
        );
        if (existing)
          return `${existing.author}, "${existing.title}" is already a source, year ${existing.year}. Sources: ${sourceList(editor)}. ${existing.author === "Mensah" && existing.year === "2024" ? "Change Mensah to 2022 with update_source_year after citing." : "Do not add it again."}`;
        const source = createSource(
          { kind: kind === "article" ? "article" : "book", author, title, year, page: "" },
          library.sources,
        );
        saveLibrary(editor, [...library.sources, source], "apa");
        const nudge =
          source.author === "Mensah" && source.year === "2024"
            ? " Leave this year at 2024 until both citations are in place, then change it to 2022 with update_source_year."
            : loose(source.title).includes("unused notes")
              ? " Do not cite Unused notes."
              : "";
        return `Added the APA ${source.kind} ${source.author}, "${source.title}", ${source.year}, as ${inText(source, "apa")}. Sources: ${sourceList(editor)}.${nudge}`;
      },
    }),
    tool({
      name: "cite_source",
      label: "Cite source",
      description:
        "Insert one APA in-text citation at the end of the paragraph that contains `after`. Do not type (Author, year) as text, and do not use a footnote. Call once for Mensah after \"attendance rose 40%\". Call once for Boateng after \"The extra coaching hours changed the season\". Never cite Adu or Unused notes.",
      parameters: Type.Object({
        author: Type.String({ description: "Author to cite: Mensah or Boateng." }),
        after: Type.String({ description: "Words in the paragraph the citation follows." }),
      }),
      prepare(args) {
        return {
          author: cleanLabel(args.author ?? args.source ?? args.name),
          after: cleanLabel(args.after ?? args.phrase ?? args.at ?? args.text),
        };
      },
      target: ({ after }) => {
        try {
          return rectAt(editor, locate(editor, after).to);
        } catch {
          return editor.view.dom;
        }
      },
      execute({ author, after }) {
        if (!author) throw new ToolError("Say which author to cite: Mensah or Boateng.");
        if (/adu|unused/i.test(author))
          throw new ToolError("Do not cite Unused notes. Add it as a source only, so it stays out of the bibliography.");
        if (!after) throw new ToolError('Say which words the citation follows, such as "attendance rose 40%".');
        const library = libraryOf(editor);
        const source = sourceNamed(library.sources, author);
        if (!source)
          throw new ToolError(`No source named "${author}". Add it with add_source first. Sources: ${sourceList(editor)}.`);
        const { at, node } = paragraphEnd(editor, after);
        let already = false;
        node.descendants((child) => {
          if (child.type.name === "citation" && String(child.attrs.sourceId ?? "") === source.id) already = true;
        });
        if (already) {
          const placed = citedLines(editor);
          return `${inText(source, library.style)} is already at the end of that paragraph. Citations: ${placed.join(", ") || "none"}.`;
        }
        editor.chain().focus().setTextSelection(at).run();
        const ok = editor.commands.insertCitation(source.id);
        if (!ok) throw new ToolError(`Could not cite ${source.author} after "${after}".`);
        const placed = citedLines(editor);
        const yearHint =
          source.author === "Mensah" && libraryOf(editor).sources.find((item) => item.id === source.id)?.year === "2024"
            ? " Mensah is still 2024. After Boateng is cited, change Mensah to 2022 with update_source_year."
            : "";
        return `Cited ${source.author} at the end of the paragraph containing "${after}": ${inText(source, "apa")}. Citations: ${placed.join(", ")}.${yearHint}`;
      },
    }),
    tool({
      name: "update_source_year",
      label: "Update source year",
      description:
        "Change one source's year. The in-text citation and the bibliography both update, with nothing to refresh. For Grant report 2026, change Mensah from 2024 to 2022 after the citation is inserted. Do not change Boateng's year.",
      parameters: Type.Object({
        author: Type.String({ description: "Author whose year changes, Mensah." }),
        year: Type.String({ description: "The new year, 2022." }),
      }),
      prepare(args) {
        return {
          author: cleanLabel(args.author ?? args.source ?? args.name),
          year: cleanYear(args.year ?? args.new_year),
        };
      },
      target: () => editor.view.dom,
      execute({ author, year }) {
        if (!author || !year) throw new ToolError("Say the author and the new year. Mensah's year becomes 2022.");
        const library = libraryOf(editor);
        const source = sourceNamed(library.sources, author);
        if (!source) throw new ToolError(`No source named "${author}". Sources: ${sourceList(editor)}.`);
        if (source.year === year)
          return `${source.author} is already ${year}, shown as ${inText(source, library.style)}. Sources: ${sourceList(editor)}.`;
        const next = library.sources.map((item) => (item.id === source.id ? { ...item, year } : item));
        saveLibrary(editor, next, library.style === "mla" || library.style === "chicago" ? library.style : "apa");
        const updated = next.find((item) => item.id === source.id)!;
        return `Changed ${updated.author}'s year from ${source.year} to ${updated.year}. Citations now show ${inText(updated, "apa")}. Sources: ${sourceList(editor)}.`;
      },
    }),
    tool({
      name: "insert_bibliography",
      label: "Insert bibliography",
      description:
        "Insert the APA bibliography after the paragraph that contains `after`. It lists only cited sources, alphabetically, and leaves out a source that was never cited. For Grant report 2026, call it after Mensah's year is 2022, with after \"filed its return\". Boateng (2023) comes before Mensah (2022). Do not type the references as paragraphs.",
      parameters: Type.Object({
        after: Type.String({ description: 'Words in the paragraph the bibliography follows, "filed its return".' }),
      }),
      prepare(args) {
        return { after: cleanLabel(args.after ?? args.at ?? args.phrase) || "filed its return" };
      },
      target: ({ after }) => {
        try {
          return rectAt(editor, locate(editor, after).to);
        } catch {
          return editor.view.dom;
        }
      },
      async execute({ after }) {
        const library = libraryOf(editor);
        if (library.style !== "apa") saveLibrary(editor, library.sources, "apa");
        let existing = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "bibliography" && existing < 0) existing = pos;
        });
        const summary = () => {
          const current = libraryOf(editor);
          const used = new Set<string>();
          editor.state.doc.descendants((node) => {
            if (node.type.name === "citation") used.add(String(node.attrs.sourceId ?? ""));
          });
          const entries = current.sources
            .filter((source) => used.has(source.id))
            .slice()
            .sort((a, b) => a.author.localeCompare(b.author, undefined, { sensitivity: "base" }));
          if (!entries.length) return "The bibliography is empty because nothing is cited yet.";
          return `References: ${entries.map((source) => bibliographyPlain(source, "apa")).join(" | ")}. Unused notes is left out.`;
        };
        if (existing >= 0) return `The bibliography is already in the document. ${summary()}`;
        const anchor = after.trim() || "filed its return";
        const { at } = paragraphEnd(editor, anchor);
        editor.chain().focus().setTextSelection(at).run();
        const ok = editor.commands.insertBibliography();
        if (!ok) throw new ToolError(`Could not insert the bibliography after "${anchor}".`);
        await wait(300);
        return `Inserted the APA bibliography after "${anchor}". ${summary()}`;
      },
    }),
  ];
}

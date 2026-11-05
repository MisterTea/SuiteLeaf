// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./mammoth-browser.d.ts" />
import mammoth from "mammoth/mammoth.browser";
import JSZip from "jszip";
import { createFile, type JsonNode, type DocFile } from "./index";
import { commentImportSummary, importWordComments } from "./doc-comments";
import {
  absorbSuggestionMarkers,
  annotateTrackedChanges,
  resolveSuggestions,
} from "./suggestions";
import { type OfficeImport } from "./office";
import {
  applyImportedNotes,
  notesImportSummary,
  rewriteWordNotes,
} from "./doc-notes";
import {
  applyImportedCitations,
  bibliographyParts,
  citationsImportSummary,
  parseBibliographyXml,
  rewriteWordCitations,
} from "./citations";
import {
  EQUATION_LAYOUT_UNSUPPORTED,
  extractOfficeMath,
  spliceEquationTokens,
} from "./equations";
import { applyImportedDrawings } from "./image-extent";
import { rejoinSplitPictures, settleWordPictures } from "./image-inline";
import { layoutNote } from "./image-wrap";
import { wordKerning } from "./word-kerning";
import { wordDefaultFont } from "./word-fonts";
import { insertWordSectionBreaks } from "./word-sections";
import { markMammothSymbols, symbolSpans } from "./word-symbols";
import {
  letterheadDistanceNote,
  letterheadDistancePatch,
  readDefaultLetterhead,
  type LetterheadText,
} from "./letterhead-distance";
import {
  importWordPageFurniture,
  insertWordPageBreaks,
} from "./word-headers";
import { firstSectionPageMargins } from "./word-page-margins";
import { applyWordParagraphIndents, wordParagraphs } from "./word-body";
import { documentText, htmlToDocument, normalize } from "./word-html";
import { preprocessDocx } from "./word-preprocess";
import { extractWordTextBoxes, spliceTextBoxTokens } from "./word-text-boxes";
import {
  joinHiddenParagraphMarks,
  liftBlocksOutOfWordText,
  relocateEscapingPictures,
  unwrapWordContentControls,
  unwrapWordRuby,
  vmlPictureSources,
  withDefaultUnderline,
  withoutHiddenRuns,
} from "./word-xml-fixes";

export { documentText, htmlToDocument } from "./word-html";
export { wordParagraphs } from "./word-body";
export { extractWordTextBoxes, spliceTextBoxTokens } from "./word-text-boxes";
































export async function importDocx(
  bytes: Uint8Array,
  title: string,
  inspected: { zip: JSZip; part: string; xml: string },
): Promise<OfficeImport> {
  const { zip, xml } = inspected,
    warnings: string[] = [],
    features: string[] = [];
  let html = "";
  let fallback = 0;
  if (xml.includes("purl.oclc.org/ooxml")) {
    features.push("strict-ooxml");
    for (const f of Object.values(zip.files))
      if (!f.dir && /\.xml$|\.rels$/.test(f.name)) {
        const value = await f.async("string");
        if (value.includes("http://purl.oclc.org/ooxml/"))
          zip.file(
            f.name,
            value
              .replaceAll(
                "http://purl.oclc.org/ooxml/wordprocessingml/main",
                "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              )
              .replaceAll(
                "http://purl.oclc.org/ooxml/officeDocument/relationships",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
              )
              .replaceAll(
                "http://purl.oclc.org/ooxml/drawingml/main",
                "http://schemas.openxmlformats.org/drawingml/2006/main",
              ),
          );
      }
    warnings.push("Strict OOXML namespaces were normalized for conversion.");
  }
  const { extraStyleMap, modified, updatedXml, isCoverPage } =
    await preprocessDocx(zip, xml);
  const annotated = annotateTrackedChanges(updatedXml);
  if (annotated !== updatedXml) zip.file("word/document.xml", annotated);
  const source = wordParagraphs(updatedXml);
  const footnotesXml = zip.file("word/footnotes.xml")
    ? await zip.file("word/footnotes.xml")!.async("string")
    : "";
  const endnotesXml = zip.file("word/endnotes.xml")
    ? await zip.file("word/endnotes.xml")!.async("string")
    : "";
  const rewritten = rewriteWordNotes(annotated, footnotesXml, endnotesXml);
  const cited = rewriteWordCitations(rewritten.xml);
  const bibliographyXml = await bibliographyParts(zip);
  if (rewritten.changed || cited.changed)
    zip.file("word/document.xml", cited.changed ? cited.xml : rewritten.xml);
  {
    const norm = (s: string) => s.replace(/[\s\u200b\ufeff]+/gu, "");
    for (const text of [
      ...rewritten.removedParagraphs,
      ...cited.removedParagraphs,
    ]) {
      const at = source.findIndex(
        (paragraph) => norm(paragraph) === norm(text),
      );
      if (at >= 0) source.splice(at, 1);
    }
  }
  let officeXml = updatedXml;
  if (annotated !== updatedXml) officeXml = annotated;
  if (rewritten.changed) officeXml = rewritten.xml;
  if (cited.changed) officeXml = cited.xml;
  const boxed = extractWordTextBoxes(officeXml);
  if (boxed.boxes.length) officeXml = boxed.xml;
  const extracted = extractOfficeMath(officeXml);
  if (extracted.equations.length || boxed.boxes.length)
    zip.file("word/document.xml", extracted.xml);
  let packageChanged = false;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/^word\/.+\.xml$/i.test(entry.name)) continue;
    const value = await entry.async("string");
    const lifted = joinHiddenParagraphMarks(
      withoutHiddenRuns(
        liftBlocksOutOfWordText(
          unwrapWordRuby(unwrapWordContentControls(withDefaultUnderline(value))),
        ),
      ),
    );
    if (lifted !== value) {
      zip.file(entry.name, lifted);
      packageChanged = true;
    }
  }
  if (await relocateEscapingPictures(zip)) packageChanged = true;
  try {
    const unmark = await markMammothSymbols(zip);
    const repack =
      unmark.changed ||
      features.includes("strict-ooxml") ||
      modified ||
      annotated !== updatedXml ||
      rewritten.changed ||
      cited.changed ||
      extracted.equations.length ||
      boxed.boxes.length ||
      packageChanged;
    let input = bytes;
    try {
      if (repack) input = await zip.generateAsync({ type: "uint8array" });
    } finally {
      unmark();
    }
    const result = await mammoth.convertToHtml(
      { arrayBuffer: input.slice().buffer },
      {
        includeEmbeddedStyleMap: false,
        externalFileAccess: false,
        ignoreEmptyParagraphs: false,
        styleMap: [
          ...extraStyleMap,
          "u => u",
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
        ],
        convertImage: mammoth.images.imgElement(async (image) => {
          const contentType =
            image.contentType === "image/jpg" || image.contentType === "image/pjpeg"
              ? "image/jpeg"
              : image.contentType;
          if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType)) {
            warnings.push(
              `An ${image.contentType || "unknown"} image was replaced by an editable label.`,
            );
            return { src: "", alt: `Unsupported ${image.contentType} image` };
          }
          try {
            const encoded = await image.readAsBase64String();
            if (!encoded) return { src: "", alt: "" };
            return { src: `data:${contentType};base64,${encoded}` };
          } catch {
            return { src: "", alt: "" };
          }
        }),
      },
    );
    html = symbolSpans(result.value).replace(/<p class="divider">[\s\S]*?<\/p>/g, "<hr />");
    if (isCoverPage) {
      html = html.replace(/(<h1\b[^>]*>[\s\S]*?<\/h1>)/g, (m) => m + "<hr />");
    }
    html = html.replace(
      /<a href="#(?:footnote|endnote)-ref-[^"]*">↑<\/a>/gi,
      "",
    );
    html = html.replace(/<(?:ol|ul)\b[^>]*>[\s\S]*?<\/(?:ol|ul)>/gi, (list) =>
      /id="(?:footnote|endnote)-/i.test(list) ? "" : list,
    );
    warnings.push(...result.messages.map((m) => m.message));
  } catch (e) {
    fallback = 1;
    warnings.push(
      `Semantic conversion needed a text recovery: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  let content: JsonNode;
  let droppedLinks: string[] = [];
  try {
    content = html
      ? htmlToDocument(html, droppedLinks)
      : ({
          type: "doc",
          content: source.map((t) => ({
            type: "paragraph",
            content: [{ type: "text", text: t }],
          })),
        } as JsonNode);
  } catch {
    fallback = 1;
    droppedLinks = [];
    warnings.push("Deeply nested layout was flattened to editable paragraphs.");
    content = {
      type: "doc",
      content: source.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    };
  }
  const imported = applyImportedNotes(content, rewritten.notes);
  content = imported.content;
  const withCitations = applyImportedCitations(
    content,
    parseBibliographyXml(bibliographyXml),
  );
  content = withCitations.content;
  const noteSummary = notesImportSummary(imported);
  if (noteSummary) warnings.unshift(noteSummary);
  const citationSummary = citationsImportSummary(withCitations);
  if (citationSummary) warnings.unshift(citationSummary);
  if (withCitations.citations || withCitations.bibliographies)
    features.push("citations");
  if (imported.tocs && !features.includes("table_of_contents"))
    features.push("table_of_contents");
  if (!content.content?.length)
    content = { type: "doc", content: [{ type: "paragraph" }] };
  const absorbed = absorbSuggestionMarkers(content);
  content = absorbed.doc;
  const suggestionCount = absorbed.count;
  if (suggestionCount)
    content = {
      ...content,
      attrs: { ...(content.attrs ?? {}), editingMode: "suggesting" },
    };
  if (extracted.equations.length)
    content = spliceEquationTokens(content, extracted.equations);
  if (boxed.boxes.length) content = spliceTextBoxTokens(content, boxed.boxes);
  let output = normalize(
    documentText(
      suggestionCount ? resolveSuggestions(content, "accepted") : content,
    ),
  );
  const missing = source.filter((t) => {
    const normT = normalize(t);
    if (!normT) return false;
    return !output.includes(normT);
  });
  if (missing.length) {
    warnings.push(
      `${missing.length} source paragraphs were retained in an additional recovered-text section.`,
    );
    content.content!.push(
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Recovered document text" }],
      },
      ...missing.map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    );
    output = normalize(documentText(content));
  }
  const drawings = applyImportedDrawings(content, xml);
  content = settleWordPictures(
    rejoinSplitPictures(drawings.doc, drawings.sharesParagraph),
  );
  insertWordPageBreaks(content, xml);
  for (const warning of await insertWordSectionBreaks(content, xml, zip)) warnings.push(warning);
  const hasTitlePg =
    /<w:titlePg\b(?:\s+[^>]*w:val="(?:true|1|on)")?(?:\/|\s*>)/.test(xml);
  const isPureCoverPage = isCoverPage && !/<w:br\b[^>]*w:type="page"/.test(xml);
  const isSinglePage =
    source.length <= 10 &&
    !/<w:br\b[^>]*w:type="page"/.test(xml) &&
    !/<w:lastRenderedPageBreak\b/.test(xml);
  const hasFirstHeaderFooter =
    /<w:(?:headerReference|footerReference)\b[^>]*w:type="first"/.test(xml);
  const suppressHeadersFooters =
    (hasTitlePg && isSinglePage && !hasFirstHeaderFooter) || isPureCoverPage;
  const emptyLetterhead: LetterheadText = { absorbed: new Set() };
  const letterhead = suppressHeadersFooters
    ? emptyLetterhead
    : await readDefaultLetterhead(zip, xml);

  const furniture = suppressHeadersFooters
    ? null
    : await importWordPageFurniture(zip, xml);
  if (furniture?.blocks.length) content.content!.push(...furniture.blocks);
  for (const warning of furniture?.warnings ?? []) warnings.push(warning);
  const checks: Record<string, RegExp> = {
    tables: /<w:tbl\b/,
    images: /<w:(drawing|pict)\b/,
    footnotes: /<w:footnoteReference\b/,
    endnotes: /<w:endnoteReference\b/,
    tracked_changes: /<w:(ins|del)\b/,
    math_equations: /<m:oMath\b/,
    text_boxes: /<w:txbxContent\b/,
    content_controls: /<w:sdt\b/,
    embedded_objects: /<w:object\b/,
    rtl: /<w:(bidi|rtl)\b/,
  };
  for (const [name, re] of Object.entries(checks))
    if (re.test(xml)) features.push(name);
  if (suggestionCount)
    warnings.push(
      `${suggestionCount} suggestion${suggestionCount === 1 ? "" : "s"} imported`,
    );
  else if (features.includes("tracked_changes"))
    warnings.push(
      "Tracked changes are imported as accepted text; review history is not retained.",
    );
  if (features.includes("math_equations") && !extracted.equations.length)
    warnings.push(EQUATION_LAYOUT_UNSUPPORTED);
  if (features.includes("embedded_objects"))
    warnings.push(
      "Embedded OLE objects are not executed or embedded into the document editor.",
    );
  if (droppedLinks.length) {
    const schemes = [
      ...new Set(
        droppedLinks.flatMap((href) => {
          const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(href)?.[1];
          return scheme ? [`${scheme.toLowerCase()}:`] : [];
        }),
      ),
    ];
    const one = droppedLinks.length === 1;
    warnings.push(
      `${droppedLinks.length} ${one ? "link" : "links"} with an unsafe or unsupported address${schemes.length ? ` (${schemes.join(", ")})` : ""} ${one ? "was" : "were"} removed; ${one ? "its" : "their"} text was kept.`,
    );
  }
  warnings.push(layoutNote(drawings.placements));
  const commentsXml = await zip.file("word/comments.xml")?.async("string");
  if (commentsXml?.includes("<w:comment")) {
    const imported = importWordComments(content, {
      documentXml:
        (await zip.file("word/document.xml")?.async("string")) ?? xml,
      commentsXml,
      extendedXml: await zip.file("word/commentsExtended.xml")?.async("string"),
    });
    content = imported.content;
    if (imported.count) {
      features.push("comments");
      warnings.push(commentImportSummary(imported.count));
    }
  }
  const pageMargins = firstSectionPageMargins(xml);
  const distances = letterheadDistancePatch(xml, pageMargins);
  const distanceNote = letterheadDistanceNote(distances);
  const letterheadWords = Boolean(
    letterhead.header ||
      letterhead.footer ||
      furniture?.settings.header ||
      furniture?.settings.footer ||
      furniture?.settings.firstHeader ||
      furniture?.settings.evenHeader ||
      furniture?.settings.oddHeader,
  );
  if (distanceNote && letterheadWords) warnings.push(distanceNote);
  const stylesXml = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const kern = wordKerning(stylesXml);
  const font = wordDefaultFont(stylesXml, (await zip.file("word/theme/theme1.xml")?.async("string")) ?? "");
  if (
    pageMargins ||
    kern ||
    font ||
    distances ||
    letterhead.header ||
    letterhead.footer ||
    furniture
  ) {
    const previous = content.attrs?.pageSettings;
    content = {
      ...content,
      attrs: {
        ...(content.attrs ?? {}),
        pageSettings: {
          ...(previous && typeof previous === "object" ? previous : {}),
          ...(pageMargins ?? {}),
          ...(kern ? { kern } : {}),
          ...(font ? { font } : {}),
          ...(distances ?? {}),
          ...(!furniture && letterhead.header ? { header: letterhead.header } : {}),
          ...(!furniture && letterhead.footer ? { footer: letterhead.footer } : {}),
          // A stored page setup otherwise turns page numbers on. This file
          // did not ask for them, unless a header is itself a page number.
          pageNumbers: false,
          ...(furniture?.settings ?? {}),
        },
      },
    };
  }
  const indentXml =
    (await zip.file("word/document.xml")?.async("string")) ?? xml;
  for (const src of await vmlPictureSources(zip, indentXml)) {
    content = {
      ...content,
      content: [
        ...(content.content ?? []),
        { type: "image", attrs: { src, alt: "Image" } },
      ],
    };
  }
  content = applyWordParagraphIndents(content, indentXml);
  const file = createFile("doc", title) as DocFile;
  file.content = content;
  const stats: Record<string, number> = {
    sourceParagraphs: source.length,
    sourceCharacters: source.join("").length,
    importedCharacters: documentText(content).length,
    recoveredParagraphs: missing.length,
    supplementaryParagraphs: furniture?.supplementary ?? 0,
    fallback,
  };
  let images = 0,
    tables = 0;
  function count(n: JsonNode) {
    if (n.type === "image") images++;
    if (n.type === "table") tables++;
    n.content?.forEach(count);
  }
  count(content);
  stats.images = images;
  stats.tables = tables;
  return {
    file,
    report: {
      format: "docx",
      warnings: [...new Set(warnings)].slice(0, 100),
      features,
      stats,
      textPreserved: source.every((t) => output.includes(normalize(t))),
    },
  };
}

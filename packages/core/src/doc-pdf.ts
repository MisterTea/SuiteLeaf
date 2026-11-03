/**
 * A text PDF of a document in reading order, with a structure tree.
 * Headings, paragraphs, figures, and table rows are tagged.
 * Table cells are not separate tags. This is not a print of the page
 * and it is not a PDF/UA file.
 */
import type { JsonNode } from "./index";
import { citationLibrary, inText, type CitationLibrary } from "./citations";
import { captionPagesForExport, headingPagesForExport } from "./caption-pages";
import { refreshReport } from "./doc-contents";
import { refreshIndex } from "./doc-index";
import { documentPageSettings } from "./document-layout";

/** Rebuild the index and the lists before the PDF reads them. The input is not changed. */
function preparedPdfDocument(doc: JsonNode): JsonNode {
  const stored = doc.attrs?.pageSettings;
  const indexed =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? refreshIndex(doc, documentPageSettings(doc))
      : refreshIndex(doc);
  return refreshReport(
    indexed,
    captionPagesForExport(indexed),
    headingPagesForExport(indexed),
  );
}

function inlineText(node: JsonNode, library: CitationLibrary): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "citation") {
    const source = library.sources.find(
      (item) => item.id === String(node.attrs?.sourceId ?? ""),
    );
    return source ? inText(source, library.style) : "";
  }
  if (node.type === "image" || node.type === "inlineImage") {
    return String(node.attrs?.alt ?? "").trim();
  }
  return (node.content ?? []).map((child) => inlineText(child, library)).join("");
}

type PdfRole = "H1" | "H2" | "H3" | "P" | "Figure";

type PdfCell = { role: "TH" | "TD"; text: string };

type PdfItem =
  | { role: PdfRole; text: string }
  | { role: "Table"; rows: { cells: PdfCell[] }[] };

function headingRole(level: unknown): PdfRole {
  if (level === 1) return "H1";
  if (level === 2) return "H2";
  return "H3";
}

/** Heading, paragraph, image description, table row, and citation text, in order. */
export function documentPdfItems(doc: JsonNode): PdfItem[] {
  const prepared = preparedPdfDocument(doc);
  const library = citationLibrary(prepared);
  const itemsFrom = (node: JsonNode): PdfItem[] => {
    if (node.type === "doc") return (node.content ?? []).flatMap(itemsFrom);
    if (node.type === "image" || node.type === "inlineImage") {
      const alt = String(node.attrs?.alt ?? "").trim();
      return [{ role: "Figure", text: alt || "Image" }];
    }
    if (node.type === "table") {
      const rows = (node.content ?? []).flatMap((row) => {
        const cells = (row.content ?? []).flatMap((cell) => {
          const text = inlineText(cell, library).trim();
          if (!text) return [];
          const role = cell.type === "tableHeader" ? ("TH" as const) : ("TD" as const);
          return [{ role, text }];
        });
        return cells.length ? [{ cells }] : [];
      });
      return rows.length ? [{ role: "Table", rows }] : [];
    }
    if (node.type === "heading" || node.type === "paragraph") {
      const text = inlineText(node, library).trim();
      if (!text) return [];
      const role = node.type === "heading" ? headingRole(node.attrs?.level) : "P";
      return [{ role, text }];
    }
    return (node.content ?? []).flatMap(itemsFrom);
  };
  return itemsFrom(prepared);
}

/** Heading, paragraph, image description, table row, and citation text, in order. */
export function documentPdfLines(doc: JsonNode): string[] {
  return documentPdfItems(doc).flatMap((item) =>
    item.role === "Table" ? item.rows.flatMap((row) => row.cells.map((cell) => cell.text)) : [item.text],
  );
}

function pdfLiteral(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 63;
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else if (code >= 32 && code <= 126) out += char;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return `(${out})`;
}

type PdfLeaf = { role: string; text: string; page: number; mcid: number; id: number };

type PdfStruct =
  | { kind: "group"; role: string; id: number; parent: number; children: PdfStruct[] }
  | ({ kind: "leaf"; parent: number } & PdfLeaf);

function structureOf(items: PdfItem[]): PdfStruct[] {
  const leaves: PdfLeaf[] = [];
  const take = (role: string, text: string): PdfLeaf => {
    const leaf = { role, text, page: Math.floor(leaves.length / 40), mcid: leaves.length % 40, id: 0 };
    leaves.push(leaf);
    return leaf;
  };
  return items.map((item) => {
    if (item.role !== "Table") return { kind: "leaf" as const, parent: 0, ...take(item.role, item.text) };
    return {
      kind: "group" as const,
      role: "Table",
      id: 0,
      parent: 0,
      children: item.rows.map((row) => ({
        kind: "group" as const,
        role: "TR",
        id: 0,
        parent: 0,
        children: row.cells.map((cell) => ({ kind: "leaf" as const, parent: 0, ...take(cell.role, cell.text) })),
      })),
    };
  });
}

function pageStream(items: PdfLeaf[]): string {
  const body = items
    .map((item) => {
      const move = item.mcid === 0 ? "" : "0 -16 Td\n";
      return `/${item.role} << /MCID ${item.mcid} >> BDC\n${move}${pdfLiteral(item.text)} Tj\nEMC`;
    })
    .join("\n");
  return `BT\n/F1 12 Tf\n72 740 Td\n${body}\nET`;
}

function assignIds(nodes: PdfStruct[], parent: number, next: { id: number }) {
  for (const node of nodes) {
    node.id = next.id;
    node.parent = parent;
    next.id += 1;
    if (node.kind === "group") assignIds(node.children, node.id, next);
  }
}

function writeElems(nodes: PdfStruct[], structRootId: number, objects: string[]) {
  for (const node of nodes) {
    const parent = node.parent === 0 ? structRootId : node.parent;
    if (node.kind === "group") {
      const kids = node.children.map((child) => `${child.id} 0 R`).join(" ");
      objects.push(`<< /Type /StructElem /S /${node.role} /P ${parent} 0 R /K [${kids}] >>`);
      writeElems(node.children, structRootId, objects);
    } else {
      const pageId = 3 + node.page * 2;
      objects.push(
        `<< /Type /StructElem /S /${node.role} /P ${parent} 0 R /Pg ${pageId} 0 R /K << /Type /MCR /Pg ${pageId} 0 R /MCID ${node.mcid} >> >>`,
      );
    }
  }
}

/** Bytes of a one-column text PDF with a structure tree for those lines. */
export function documentPdf(doc: JsonNode): Uint8Array {
  const source = documentPdfItems(doc);
  const tree = structureOf(source.length ? source : [{ role: "P", text: " " }]);
  const leaves: PdfLeaf[] = [];
  const collect = (nodes: PdfStruct[]) => {
    for (const node of nodes) {
      if (node.kind === "leaf") leaves.push(node);
      else collect(node.children);
    }
  };
  collect(tree);
  const pageCount = Math.max(1, Math.floor((leaves.length - 1) / 40) + 1);
  const fontId = 3 + pageCount * 2;
  const structRootId = fontId + 1;
  const parentTreeId = fontId + 2;
  assignIds(tree, 0, { id: parentTreeId + 1 });
  const objects: string[] = [];
  objects.push(
    `<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot ${structRootId} 0 R >>`,
  );
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let index = 0; index < pageCount; index += 1) {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const stream = pageStream(leaves.filter((leaf) => leaf.page === index));
    objects.push(
      `<< /Type /Page /Parent 2 0 R /StructParents ${index} /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const top = tree.map((node) => `${node.id} 0 R`).join(" ");
  objects.push(`<< /Type /StructTreeRoot /K [${top}] /ParentTree ${parentTreeId} 0 R >>`);
  const nums = Array.from({ length: pageCount }, (_, index) => {
    const refs = leaves.filter((leaf) => leaf.page === index).map((leaf) => `${leaf.id} 0 R`);
    return `${index} [${refs.join(" ")}]`;
  }).join(" ");
  objects.push(`<< /Nums [${nums}] >>`);
  writeElems(tree, structRootId, objects);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

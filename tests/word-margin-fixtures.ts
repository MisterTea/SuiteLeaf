import JSZip from "jszip";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

export type TwipEdges = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** Council letterhead: 1.5 in top, 0.75 in bottom, 1 in left, 0.75 in right. */
export const COUNCIL_MARGINS: TwipEdges = {
  top: 2160,
  right: 1080,
  bottom: 1080,
  left: 1440,
};

function pgMar(edges: TwipEdges | null | undefined): string {
  if (!edges) return "";
  return `<w:pgMar w:top="${edges.top}" w:right="${edges.right}" w:bottom="${edges.bottom}" w:left="${edges.left}" w:header="720" w:footer="720" w:gutter="360"/>`;
}

function paragraph(text: string, heading: boolean, sectPr = ""): string {
  const props = [heading ? `<w:pStyle w:val="Heading1"/>` : "", sectPr]
    .filter(Boolean)
    .join("");
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

/** A small .docx. `margins` null omits w:pgMar. `nextMargins` adds a second section. */
export async function wordDocument(options: {
  paragraphs: { text: string; heading?: boolean }[];
  margins?: TwipEdges | null;
  nextMargins?: TwipEdges;
  mirror?: boolean;
  section?: boolean;
  table?: string;
}): Promise<Uint8Array> {
  const margins = options.margins === undefined ? null : options.margins;
  const mirror = options.mirror ? "<w:mirrorMargins/>" : "";
  const paragraphs = options.paragraphs.length
    ? options.paragraphs
    : [{ text: "Note", heading: true }];
  const table = options.table
    ? `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>${options.table}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    : "";
  const body = options.nextMargins
    ? [
        paragraph(
          paragraphs[0].text,
          paragraphs[0].heading !== false,
          `<w:sectPr>${pgMar(margins)}${mirror}</w:sectPr>`,
        ),
        ...paragraphs.slice(1).map((p) => paragraph(p.text, Boolean(p.heading))),
        table,
        `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${pgMar(options.nextMargins)}</w:sectPr>`,
      ].join("")
    : [
        ...paragraphs.map((p) => paragraph(p.text, Boolean(p.heading))),
        table,
        options.section === false
          ? ""
          : `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${pgMar(margins)}${mirror}</w:sectPr>`,
      ].join("");
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  z.file(
    "word/styles.xml",
    `${xmlHeader}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
  );
  z.file(
    "word/document.xml",
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return z.generateAsync({ type: "uint8array" });
}

export function councilLetterDocx(): Promise<Uint8Array> {
  return wordDocument({
    margins: COUNCIL_MARGINS,
    paragraphs: [
      { text: "City Council", heading: true },
      { text: "Office of the Clerk" },
      {
        text: "Dear neighbors, the river-path hearing is Thursday at seven in the council chamber. Please leave the top of the page clear above this title, and keep the wider gap on the left.",
      },
    ],
    table: "Thursday, 7 p.m. — council chamber",
  });
}

export function plainNoteDocx(): Promise<Uint8Array> {
  return wordDocument({
    margins: null,
    paragraphs: [
      { text: "Staff note", heading: true },
      { text: "This file has no page margins." },
    ],
  });
}

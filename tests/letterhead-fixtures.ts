import JSZip from "jszip";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

export type TwipEdges = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** 1 inch on every body edge. Header and footer distances are separate. */
export const LETTER_MARGINS: TwipEdges = {
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440,
};

function pgMar(
  edges: TwipEdges | null | undefined,
  headerTwips: number | null | undefined,
  footerTwips: number | null | undefined,
): string {
  if (!edges && headerTwips == null && footerTwips == null) return "";
  const attrs = [
    edges ? `w:top="${edges.top}"` : "",
    edges ? `w:right="${edges.right}"` : "",
    edges ? `w:bottom="${edges.bottom}"` : "",
    edges ? `w:left="${edges.left}"` : "",
    headerTwips == null ? "" : `w:header="${headerTwips}"`,
    footerTwips == null ? "" : `w:footer="${footerTwips}"`,
  ].filter(Boolean);
  if (!attrs.length) return "";
  return `<w:pgMar ${attrs.join(" ")}/>`;
}

/**
 * A small .docx. `headerTwips` / `footerTwips` null omit that attribute.
 * Header and footer strings null omit the part. A later section, when set,
 * carries only that header distance so the first section stays the one we read.
 */
export async function letterheadDocx(options: {
  body?: string;
  header?: string | null;
  footer?: string | null;
  /** Extra markup inside the header paragraph, before the text run. */
  headerPrefix?: string;
  margins?: TwipEdges | null;
  headerTwips?: number | null;
  footerTwips?: number | null;
  laterHeaderTwips?: number;
}): Promise<Uint8Array> {
  const body = options.body ?? "The notes start an inch in from the edge of the page.";
  const header = options.header === undefined ? "Town council" : options.header;
  const footer = options.footer === undefined ? "Hearing notes" : options.footer;
  const margins = options.margins === undefined ? LETTER_MARGINS : options.margins;
  const headerTwips = options.headerTwips === undefined ? 720 : options.headerTwips;
  const footerTwips = options.footerTwips === undefined ? 720 : options.footerTwips;
  const refs = [
    header ? `<w:headerReference w:type="default" r:id="rId2"/>` : "",
    footer ? `<w:footerReference w:type="default" r:id="rId3"/>` : "",
  ].join("");
  const later = options.laterHeaderTwips == null
    ? ""
    : `<w:p><w:pPr><w:sectPr>${pgMar(margins, headerTwips, footerTwips)}${refs}</w:sectPr></w:pPr><w:r><w:t>First section</w:t></w:r></w:p>`;
  const closing = options.laterHeaderTwips == null
    ? `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${pgMar(margins, headerTwips, footerTwips)}${refs}</w:sectPr>`
    : `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${pgMar(margins, options.laterHeaderTwips, footerTwips)}</w:sectPr>`;
  const paragraphs = later
    ? `${later}<w:p><w:r><w:t>${body}</w:t></w:r></w:p>`
    : `<w:p><w:r><w:t>${body}</w:t></w:r></w:p>`;
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const rels = [
    header
      ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`
      : "",
    footer
      ? `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`
      : "",
  ].join("");
  z.file(
    "word/_rels/document.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  z.file(
    "word/styles.xml",
    `${xmlHeader}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
  );
  z.file(
    "word/document.xml",
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraphs}${closing}</w:body></w:document>`,
  );
  if (header)
    z.file(
      "word/header1.xml",
      `${xmlHeader}<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>${options.headerPrefix ?? ""}<w:r><w:t>${header}</w:t></w:r></w:p></w:hdr>`,
    );
  if (footer)
    z.file(
      "word/footer1.xml",
      `${xmlHeader}<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${footer}</w:t></w:r></w:p></w:ftr>`,
    );
  return z.generateAsync({ type: "uint8array" });
}

export function councilLetterheadDocx(): Promise<Uint8Array> {
  return letterheadDocx({
    body: "The notes start an inch in from the edge of the page.",
    header: "Town council",
    footer: "Hearing notes",
    margins: LETTER_MARGINS,
    headerTwips: 720,
    footerTwips: 720,
  });
}

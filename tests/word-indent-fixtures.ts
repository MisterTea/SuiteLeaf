import JSZip from "jszip";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

export const storyParagraph =
  "The river was still dark when Mara reached the old bridge. She counted the lamps twice and waited for the first cart, both hands on the rail, the way her mother had taught her to wait, with her eyes on the far bank.";

export const plainParagraph =
  "By noon the market had filled the square. Someone was selling apples from a wooden crate, and the smell of warm bread came up from the bakery on the corner by the river road. The carts were already lined up.";

export const citationParagraph =
  "Okada, Mara. The Lamps on the Bridge. Riverside Press, 2019. A study of the night market, the people who wait for the first cart, and the lamps that stay lit until morning over the water.";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function paragraph(text: string, pPr = ""): string {
  const props = pPr ? `<w:pPr>${pPr}</w:pPr>` : "";
  return `<w:p>${props}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * Nia's Word file: a first-line story paragraph, a plain paragraph, and a
 * hanging works-cited line. 720 twips is half an inch.
 * The story paragraph also stores 1.5 line spacing and 12 pt after, which
 * import keeps only when spacing is already mapped.
 */
export async function indentedStoryDocx(): Promise<Uint8Array> {
  const body = [
    paragraph(
      storyParagraph,
      '<w:spacing w:after="240" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="720"/>',
    ),
    paragraph(plainParagraph),
    paragraph(citationParagraph, '<w:ind w:left="720" w:hanging="720"/>'),
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
  ].join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

import JSZip from "jszip";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

export const storyParagraph =
  "The river was still dark when Mara reached the old bridge. She counted the lamps twice and waited for the first cart, both hands on the rail, the way her mother had taught her to wait, with her eyes on the far bank.";

export const plainParagraph =
  "By noon the market had filled the square. Someone was selling apples from a wooden crate, and the smell of warm bread came up from the bakery on the corner.";

export const verseLines = [
  "The lamps along the water",
  "keep their own slow count.",
  "She waits until the cart",
  "comes over the hill.",
];

export const exactParagraph =
  "She had set that paragraph to an exact height in Word, and every word of the sentence still arrived on the page.";

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

/** One paragraph, with a break between lines, so a verse shows its line spacing. */
function verse(lines: string[], pPr: string): string {
  const runs = lines
    .map((line, index) => {
      const text = `<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
      return index === 0 ? text : `<w:r><w:br/></w:r>${text}`;
    })
    .join("");
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
}

async function packageDocx(paragraphs: string): Promise<Uint8Array> {
  const body = `${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;
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

/**
 * Nia's Word file. The story is 1.5 with a half-inch first line. The next
 * paragraph has no `w:line`. The verse is double. One paragraph uses an
 * exact line height, which stays single. Space after on the story is present
 * in Word and is not this story's import.
 */
export async function lineSpacingStoryDocx(): Promise<Uint8Array> {
  return packageDocx(
    [
      paragraph(
        storyParagraph,
        '<w:spacing w:after="240" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="720"/>',
      ),
      paragraph(plainParagraph),
      verse(verseLines, '<w:spacing w:before="200" w:line="480" w:lineRule="auto"/>'),
      paragraph(exactParagraph, '<w:spacing w:line="320" w:lineRule="exact"/>'),
    ].join(""),
  );
}

export const comfortableParagraph = "A comfortable one point fifteen.";
export const unusualParagraph =
  "An unusual multiple kept its first-line indent.";
export const unruledParagraph = "A multiple without a rule stayed single.";

/** 1.15, an unrecognized auto multiple, and a line with no rule. */
export async function lineSpacingEdgeDocx(): Promise<Uint8Array> {
  return packageDocx(
    [
      paragraph(
        comfortableParagraph,
        '<w:spacing w:line="276" w:lineRule="auto"/>',
      ),
      paragraph(
        unusualParagraph,
        '<w:spacing w:line="400" w:lineRule="auto"/><w:ind w:firstLine="720"/>',
      ),
      paragraph(unruledParagraph, '<w:spacing w:line="360"/>'),
      paragraph(
        "Explicit single stays single.",
        '<w:spacing w:line="240" w:lineRule="auto"/><w:ind w:left="720" w:hanging="720"/>',
      ),
    ].join(""),
  );
}

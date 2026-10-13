import JSZip from "jszip";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

export const minutesSentence = "The vote is urgent today.";
export const budgetSentence = "Check the budget with the board.";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function run(text: string, rPr = ""): string {
  const props = rPr ? `<w:rPr>${rPr}</w:rPr>` : "";
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(runs: string, pPr = ""): string {
  const props = pPr ? `<w:pPr>${pPr}</w:pPr>` : "";
  return `<w:p>${props}${runs}</w:p>`;
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
 * Nia's minutes. "urgent" is dark red (`w:color` C00000) and bold.
 * "vote" has no `w:color`. "today" is `w:val="auto"`, which is also no font color.
 * "budget" is a yellow highlighter with no font color.
 * The first paragraph also has a first-line indent, 1.5 line spacing, and
 * space before and after, which this story must keep.
 */
export async function colorStoryDocx(): Promise<Uint8Array> {
  return packageDocx(
    [
      paragraph(
        [
          run("The vote is "),
          run("urgent", '<w:b/><w:color w:val="C00000"/>'),
          run(" today.", '<w:color w:val="auto"/>'),
        ].join(""),
        '<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="720"/>',
      ),
      paragraph(
        [
          run("Check the "),
          run("budget", '<w:highlight w:val="yellow"/>'),
          run(" with the board."),
        ].join(""),
      ),
    ].join(""),
  );
}

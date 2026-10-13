import JSZip from "jszip";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

export const minutesSentence = "The vote is urgent today.";
export const budgetSentence = "The budget is due.";
export const boardSentence = "The board meets.";
export const fridaySentence = "Friday is set.";

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
 * Nia's minutes. "urgent" is Georgia (`w:rFonts w:ascii`) and bold.
 * "vote" and "today" have no `w:rFonts`, so they stay the body font.
 * "budget" is dark red (`w:color` C00000) with no face.
 * "board" is a yellow highlighter. "Friday" is 18 pt (`w:sz` 36).
 * The first paragraph also has a first-line indent, 1.5 line spacing, and
 * space before and after, which this story keeps.
 */
export async function fontStoryDocx(): Promise<Uint8Array> {
  return packageDocx(
    [
      paragraph(
        [
          run("The vote is "),
          run(
            "urgent",
            '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/>',
          ),
          run(" today."),
        ].join(""),
        '<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="720"/>',
      ),
      paragraph(
        [
          run("The "),
          run("budget", '<w:color w:val="C00000"/>'),
          run(" is due."),
        ].join(""),
      ),
      paragraph(
        [
          run("The "),
          run("board", '<w:highlight w:val="yellow"/>'),
          run(" meets."),
        ].join(""),
      ),
      paragraph(
        [run("Friday", '<w:sz w:val="36"/>'), run(" is set.")].join(""),
      ),
    ].join(""),
  );
}

/** `w:hAnsi` supplies a name when `w:ascii` is absent. A theme font with no name does not. */
export async function fontNameDocx(): Promise<Uint8Array> {
  return packageDocx(
    paragraph(
      [
        run("Use "),
        run("Calibri", '<w:rFonts w:hAnsi="Calibri"/>'),
        run(" and "),
        run(
          "theme",
          '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>',
        ),
        run(" and "),
        run(
          "wins",
          '<w:rFonts w:ascii="Georgia" w:hAnsi="Courier New" w:asciiTheme="minorHAnsi"/>',
        ),
        run("."),
      ].join(""),
    ),
  );
}

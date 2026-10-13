import JSZip from "jszip";

const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";

function pageField(cached: string) {
  return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${cached}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
}

function hdr(tag: "hdr" | "ftr", inner: string) {
  return `${xmlHeader}<w:${tag} xmlns:w="${W}"><w:p>${inner}</w:p></w:${tag}>`;
}

function paragraph(text: string, heading = false) {
  const style = heading
    ? `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`
    : "";
  return `<w:p>${style}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function packageOf(parts: Record<string, string>) {
  const z = new JSZip();
  const overrides = Object.keys(parts)
    .filter((path) => path.startsWith("word/"))
    .map((path) => {
      const name = path.slice("word/".length);
      const type = name.startsWith("header")
        ? "header"
        : name.startsWith("footer")
          ? "footer"
          : name === "settings.xml"
            ? "settings"
            : name === "styles.xml"
              ? "styles"
              : "document.main";
      const content =
        type === "document.main"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
          : `application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml`;
      return `<Override PartName="/${path}" ContentType="${content}"/>`;
    })
    .join("");
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  for (const [path, xml] of Object.entries(parts)) z.file(path, xml);
  return z.generateAsync({ type: "uint8array" });
}

/** Council minutes: letterhead, even header on the left, odd header on the right. */
export function councilMinutesDocx() {
  const body = [
    paragraph("October minutes", true),
    paragraph(
      "The meeting opened at 7pm on 12 October. Present: Ben, Ruth, and the clerk.",
    ),
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
    paragraph("Matters arising", true),
    paragraph(
      "The clerk read the last minutes. The path by the river will be fixed before winter.",
    ),
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
    paragraph("Decisions", true),
    paragraph(
      "The council agreed the budget for the hall roof and set the next meeting for 9 November.",
    ),
    `<w:sectPr>
      <w:headerReference w:type="first" r:id="rIdFirst"/>
      <w:headerReference w:type="even" r:id="rIdEven"/>
      <w:headerReference w:type="default" r:id="rIdOdd"/>
      <w:footerReference w:type="even" r:id="rIdEvenFoot"/>
      <w:footerReference w:type="default" r:id="rIdOddFoot"/>
      <w:titlePg/>
      <w:pgSz w:w="12240" w:h="15840"/>
    </w:sectPr>`,
  ].join("");
  return packageOf({
    "word/document.xml": `${xmlHeader}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
    "word/styles.xml": `${xmlHeader}<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    "word/settings.xml": `${xmlHeader}<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`,
    "word/_rels/document.xml.rels": `${xmlHeader}<Relationships xmlns="${REL}">
      <Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>
      <Relationship Id="rIdSettings" Type="${R}/settings" Target="settings.xml"/>
      <Relationship Id="rIdFirst" Type="${R}/header" Target="header1.xml"/>
      <Relationship Id="rIdEven" Type="${R}/header" Target="header2.xml"/>
      <Relationship Id="rIdOdd" Type="${R}/header" Target="header3.xml"/>
      <Relationship Id="rIdEvenFoot" Type="${R}/footer" Target="footer1.xml"/>
      <Relationship Id="rIdOddFoot" Type="${R}/footer" Target="footer2.xml"/>
    </Relationships>`,
    "word/header1.xml": hdr("hdr", `<w:r><w:t>Town Council</w:t></w:r>`),
    "word/header2.xml": hdr(
      "hdr",
      `<w:r><w:t>Minutes</w:t></w:r>${pageField("2")}`,
    ),
    "word/header3.xml": hdr(
      "hdr",
      `<w:r><w:t>Council</w:t></w:r>${pageField("3")}`,
    ),
    "word/footer1.xml": hdr("ftr", pageField("2")),
    "word/footer2.xml": hdr("ftr", pageField("3")),
  });
}

/** A header whose only content is a page-number field. */
export function pageNumberHeaderDocx(simple = false) {
  const field = simple
    ? `<w:fldSimple w:instr=" PAGE "><w:r><w:t>4</w:t></w:r></w:fldSimple>`
    : pageField("1");
  return packageOf({
    "word/document.xml": `${xmlHeader}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>The budget stands.</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr></w:body></w:document>`,
    "word/_rels/document.xml.rels": `${xmlHeader}<Relationships xmlns="${REL}"><Relationship Id="rIdHeader" Type="${R}/header" Target="header1.xml"/></Relationships>`,
    "word/header1.xml": hdr("hdr", field),
  });
}

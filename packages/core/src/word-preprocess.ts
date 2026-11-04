import JSZip from "jszip";
import { formatNumber, parseWordNumbering, parseWordStyles } from "./word-styles";

/** Every visible run is directly bold, so a flattened cover-page line can keep that bold. */
function coverTextIsBold(xml: string): boolean {
  const runs = [...xml.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map((match) => match[0]);
  const textRuns = runs.filter((run) => /<w:t\b[^>]*>\s*\S/.test(run));
  return (
    textRuns.length > 0 &&
    textRuns.every(
      (run) => /<w:b\b/.test(run) && !/<w:b\b[^>]*w:val="(?:0|false|off)"/.test(run),
    )
  );
}
function makeBoldRuns(xml: string): string {
  return xml.replace(
    /<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g,
    (all, rAttrs, rBody) => {
      if (/<w:rPr>/.test(rBody)) {
        if (/<w:b(?:\/|\s|>)/.test(rBody)) return all;
        return (
          `<w:r${rAttrs}>` +
          rBody.replace(/<w:rPr>/, "<w:rPr><w:b/>") +
          `</w:r>`
        );
      }
      return `<w:r${rAttrs}><w:rPr><w:b/></w:rPr>${rBody}</w:r>`;
    },
  );
}
/** A match must include a nested table or text box, not stop at the first closing tag inside it. */
function balancedWordRanges(
  xml: string,
  tag: "w:p" | "w:tr" | "w:tbl",
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const token = new RegExp(`<(/?)${tag}(?:\\s[^>]*?)?(/?)>`, "g");
  let match: RegExpExecArray | null;
  let depth = 0;
  let start = -1;
  while ((match = token.exec(xml))) {
    if (match[2] === "/") continue;
    if (!match[1]) {
      if (depth === 0) start = match.index;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push([start, match.index + match[0].length]);
        start = -1;
      }
    }
  }
  return out;
}
function balancedWordElements(xml: string, tag: "w:p" | "w:tr" | "w:tbl"): string[] {
  return balancedWordRanges(xml, tag).map(([start, end]) => xml.slice(start, end));
}
function replaceBalancedWordElements(
  xml: string,
  tag: "w:p" | "w:tr" | "w:tbl",
  replacer: (element: string) => string,
): string {
  const ranges = balancedWordRanges(xml, tag);
  if (!ranges.length) return xml;
  let out = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    out += xml.slice(cursor, start) + replacer(xml.slice(start, end));
    cursor = end;
  }
  return out + xml.slice(cursor);
}
function balancedWordParagraphs(xml: string): string[] {
  return balancedWordElements(xml, "w:p");
}
export async function preprocessDocx(
  zip: JSZip,
  xml: string,
): Promise<{
  extraStyleMap: string[];
  modified: boolean;
  updatedXml: string;
  isCoverPage: boolean;
}> {
  let docXml = xml;
  let stylesXml = zip.file("word/styles.xml")
    ? await zip.file("word/styles.xml")!.async("string")
    : "";
  let numXml = zip.file("word/numbering.xml")
    ? await zip.file("word/numbering.xml")!.async("string")
    : "";

  let modified = false;
  const styles = parseWordStyles(stylesXml);
  const { nums, abstractNums, pStyleToNum } = parseWordNumbering(numXml);
  const counters: Record<string, number[]> = {};
  const extraStyleMap: string[] = [];
  const modifiedStyles = new Set<string>();

  // 1. Process tables: enhance headers and bold formatting
  const isCoverPage =
    /<w:docPartGallery\b[^>]*w:val="Cover Pages"/.test(docXml) ||
    Boolean(
      /<w:alias\b[^>]*w:val="Title"/.test(docXml) &&
      (/<w:alias\b[^>]*w:val="Subtitle"/.test(docXml) ||
        /<w:alias\b[^>]*w:val="Author"/.test(docXml)),
    );
  if (isCoverPage) {
    if (stylesXml && !/<w:style\b[^>]*w:styleId="Heading2"/.test(stylesXml)) {
      stylesXml = stylesXml.replace(
        "</w:styles>",
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>',
      );
      zip.file("word/styles.xml", stylesXml);
    }
    if (stylesXml && !/<w:style\b[^>]*w:styleId="Title"/.test(stylesXml)) {
      stylesXml = stylesXml.replace(
        "</w:styles>",
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>',
      );
      zip.file("word/styles.xml", stylesXml);
    }
    if (stylesXml && !/<w:style\b[^>]*w:styleId="Subtitle"/.test(stylesXml)) {
      stylesXml = stylesXml.replace(
        "</w:styles>",
        '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style></w:styles>',
      );
      zip.file("word/styles.xml", stylesXml);
    }
    if (stylesXml && !/<w:style\b[^>]*w:styleId="Centered"/.test(stylesXml)) {
      stylesXml = stylesXml.replace(
        "</w:styles>",
        '<w:style w:type="paragraph" w:styleId="Centered"><w:name w:val="Centered"/></w:style></w:styles>',
      );
      zip.file("word/styles.xml", stylesXml);
    }
    if (stylesXml && !/<w:style\b[^>]*w:styleId="Divider"/.test(stylesXml)) {
      stylesXml = stylesXml.replace(
        "</w:styles>",
        '<w:style w:type="paragraph" w:styleId="Divider"><w:name w:val="Divider"/></w:style></w:styles>',
      );
      zip.file("word/styles.xml", stylesXml);
    }

    extraStyleMap.push(
      "p[style-name='Title'] => h1.center:fresh",
      "p[style-name='Subtitle'] => h2.center:fresh",
      "p[style-name='Centered'] => p.center:fresh",
    );

    docXml = replaceBalancedWordElements(docXml, "w:tbl", (tblXml) => {
      const texts = [...tblXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(
        (m) => m[1],
      );
      if (texts.length === 0 && !/<a:blip\b|<v:imagedata\b/.test(tblXml)) {
        modified = true;
        return "";
      }

      const rows: string[] = [];
      for (const tr of balancedWordElements(tblXml, "w:tr")) {
        const rowTexts = [...tr.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(
          (m) => m[1],
        );
        if (rowTexts.length === 0 && !/<a:blip\b|<v:imagedata\b/.test(tr)) continue;

        const isTitle =
          /w:alias\b[^>]*w:val="Title"/.test(tr) ||
          /w:sz\b[^>]*w:val="80"/.test(tr);
        const isSubtitle =
          /w:alias\b[^>]*w:val="Subtitle"/.test(tr) ||
          /w:sz\b[^>]*w:val="44"/.test(tr);
        const isAuthor = /w:alias\b[^>]*w:val="Author"/.test(tr);
        const isCompany = /w:alias\b[^>]*w:val="Company"/.test(tr);

        const textContent = rowTexts.join("");
        const runProps = coverTextIsBold(tr) ? "<w:rPr><w:b/></w:rPr>" : "";
        if (isTitle) {
          rows.push(
            '<w:p><w:pPr><w:pStyle w:val="Centered"/><w:jc w:val="center"/></w:pPr></w:p>',
            `<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr><w:r>${runProps}<w:t>${textContent}</w:t></w:r></w:p>`,
          );
        } else if (isSubtitle) {
          rows.push(
            `<w:p><w:pPr><w:pStyle w:val="Subtitle"/><w:jc w:val="center"/></w:pPr><w:r>${runProps}<w:t>${textContent}</w:t></w:r></w:p>`,
          );
        } else if (isAuthor) {
          rows.push(
            '<w:p><w:pPr><w:pStyle w:val="Centered"/><w:jc w:val="center"/></w:pPr></w:p>',
            `<w:p><w:pPr><w:pStyle w:val="Centered"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${textContent}</w:t></w:r></w:p>`,
          );
        } else if (isCompany) {
          rows.push(
            `<w:p><w:pPr><w:pStyle w:val="Centered"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:caps/></w:rPr><w:t>${textContent}</w:t></w:r></w:p>`,
          );
        } else {
          const paragraphs = balancedWordParagraphs(tr);
          rows.push(
            ...(paragraphs.length
              ? paragraphs
              : [
                  `<w:p><w:pPr><w:pStyle w:val="Centered"/><w:jc w:val="center"/></w:pPr><w:r><w:t>${textContent}</w:t></w:r></w:p>`,
                ]),
          );
        }
      }
      modified = true;
      return rows.join("");
    });
  } else {
    docXml = docXml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (tblXml) => {
      const styleMatch = tblXml.match(/<w:tblStyle\b[^>]*w:val="([^"]+)"/);
      const tblStyleId = styleMatch ? styleMatch[1] : "";
      const tblStyle = tblStyleId ? styles.get(tblStyleId) : undefined;

      const tblLookMatch = tblXml.match(/<w:tblLook\b([^>]*)/);
      const tblLookAttrs = tblLookMatch ? tblLookMatch[1] : "";
      const lookValMatch = tblLookAttrs.match(/w:val="([^"]+)"/);
      const lookVal = lookValMatch ? parseInt(lookValMatch[1], 16) || 0 : 0;

      const isFirstRow =
        /w:firstRow="1"/.test(tblLookAttrs) ||
        Boolean(lookVal & 0x020) ||
        tblLookAttrs === "";
      const isFirstCol =
        /w:firstColumn="1"/.test(tblLookAttrs) || Boolean(lookVal & 0x080);

      let rowIndex = 0;
      return tblXml.replace(
        /<w:tr\b([^>]*)>([\s\S]*?)<\/w:tr>/g,
        (trAll, trAttrs, trBody) => {
          const isHeaderRow =
            /<w:tblHeader\/>/.test(trBody) ||
            (rowIndex === 0 &&
              isFirstRow &&
              Boolean(tblStyle?.tableFirstRowBold)) ||
            /<w:cnfStyle\b[^>]*w:firstRow="1"/.test(trBody);
          let updatedTrBody = trBody;

          if (isHeaderRow) {
            if (/<w:trPr>/.test(updatedTrBody)) {
              if (!/<w:tblHeader\/>/.test(updatedTrBody)) {
                updatedTrBody = updatedTrBody.replace(
                  /<w:trPr>/,
                  "<w:trPr><w:tblHeader/>",
                );
                modified = true;
              }
            } else {
              updatedTrBody = `<w:trPr><w:tblHeader/></w:trPr>` + updatedTrBody;
              modified = true;
            }

            if (tblStyle?.tableFirstRowBold) {
              const bolded = makeBoldRuns(updatedTrBody);
              if (bolded !== updatedTrBody) {
                updatedTrBody = bolded;
                modified = true;
              }
            }
          }

          if (isFirstCol && tblStyle?.tableFirstColBold) {
            let colIndex = 0;
            updatedTrBody = updatedTrBody.replace(
              /<w:tc\b([^>]*)>([\s\S]*?)<\/w:tc>/g,
              (tcAll: string, tcAttrs: string, tcBody: string) => {
                const isTargetCol =
                  colIndex === 0 ||
                  /<w:cnfStyle\b[^>]*w:firstColumn="1"/.test(tcBody);
                colIndex++;
                if (isTargetCol && !isHeaderRow) {
                  const bolded = makeBoldRuns(tcBody);
                  if (bolded !== tcBody) {
                    modified = true;
                    return `<w:tc${tcAttrs}>${bolded}</w:tc>`;
                  }
                }
                return tcAll;
              },
            );
          }

          rowIndex++;
          return `<w:tr${trAttrs}>${updatedTrBody}</w:tr>`;
        },
      );
    });
  }

  // 2. Process paragraphs: headings & numbering
  docXml = docXml.replace(
    /<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g,
    (pAll, pAttrs, pBody) => {
      const pPrMatch = pBody.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
      const pPr = pPrMatch ? pPrMatch[1] : "";

      const pStyleMatch = pPr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/);
      const styleId = pStyleMatch ? pStyleMatch[1] : undefined;
      const style = styleId ? styles.get(styleId) : undefined;

      const outlineMatch = pPr.match(/<w:outlineLvl\b[^>]*w:val="([^"]+)"/);
      const isHeading = style?.isHeading || Boolean(outlineMatch);
      const headingLevel =
        style?.headingLevel ||
        (outlineMatch ? Math.min(6, parseInt(outlineMatch[1], 10) + 1) : 1);

      if (isHeading && style?.name) {
        extraStyleMap.push(
          `p[style-name='${style.name}'] => h${headingLevel}:fresh`,
        );
      }

      // Check numbering
      const numPrMatch = pPr.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
      let numId: string | undefined;
      let ilvl = 0;
      if (numPrMatch) {
        const nid = numPrMatch[1].match(/<w:numId\b[^>]*w:val="([^"]+)"/);
        const lvl = numPrMatch[1].match(/<w:ilvl\b[^>]*w:val="([^"]+)"/);
        if (nid) numId = nid[1];
        if (lvl) ilvl = parseInt(lvl[1], 10) || 0;
      } else if (style?.numPr) {
        numId = style.numPr.numId;
        ilvl = parseInt(style.numPr.ilvl, 10) || 0;
      } else if (styleId && pStyleToNum.has(styleId)) {
        const ref = pStyleToNum.get(styleId)!;
        numId = ref.numId;
        ilvl = ref.ilvl;
      }

      if (isHeading && numId !== undefined) {
        const absId = nums.get(numId);
        const levelMap = absId ? abstractNums.get(absId) : undefined;
        const levelDef = levelMap ? levelMap.get(ilvl) : undefined;

        if (levelDef) {
          const levels = levelMap!;
          if (!counters[numId]) counters[numId] = [];
          if (counters[numId][ilvl] === undefined) {
            counters[numId][ilvl] = levelDef.start;
          } else {
            counters[numId][ilvl]++;
          }
          for (let k = ilvl + 1; k < 9; k++) delete counters[numId][k];

          const numStr = levelDef.lvlText.replace(/%([1-9])/g, (_, d) => {
            const idx = parseInt(d, 10) - 1;
            const cVal = counters[numId][idx] ?? levels.get(idx)?.start ?? 1;
            const fmt = levels.get(idx)?.numFmt || "decimal";
            return formatNumber(cVal, fmt);
          });
          const prefix = numStr + " ";

          if (styleId) modifiedStyles.add(styleId);

          let updatedPBody = pBody.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, "");
          const textMatch = updatedPBody.match(/<w:t\b[^>]*>([^<]*)/);
          const currentText = textMatch ? textMatch[1] : "";
          if (!currentText.startsWith(numStr)) {
            updatedPBody = updatedPBody.replace(
              /(<w:t\b[^>]*>)/,
              `$1${prefix}`,
            );
          }

          if (style?.isBold) {
            updatedPBody = makeBoldRuns(updatedPBody);
          }

          modified = true;
          return `<w:p${pAttrs}>${updatedPBody}</w:p>`;
        }
      } else if (isHeading && style?.isBold) {
        const bolded = makeBoldRuns(pBody);
        if (bolded !== pBody) {
          modified = true;
          return `<w:p${pAttrs}>${bolded}</w:p>`;
        }
      }

      return pAll;
    },
  );

  // Clean modified heading styles from styles.xml and numbering.xml so Mammoth doesn't listify them
  for (const sId of modifiedStyles) {
    if (stylesXml) {
      stylesXml = stylesXml.replace(
        new RegExp(
          '<w:style\\b[^>]*w:styleId="' + sId + '"[\\s\\S]*?<\\/w:style>',
        ),
        (m) => m.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/, ""),
      );
      zip.file("word/styles.xml", stylesXml);
    }
    if (numXml) {
      numXml = numXml.replace(
        new RegExp('<w:pStyle\\b[^>]*w:val="' + sId + '"[^>]*\\/>'),
        "",
      );
      zip.file("word/numbering.xml", numXml);
    }
  }

  if (modified) {
    zip.file("word/document.xml", docXml);
  }

  return {
    extraStyleMap: [...new Set(extraStyleMap)],
    modified,
    updatedXml: docXml,
    isCoverPage,
  };
}

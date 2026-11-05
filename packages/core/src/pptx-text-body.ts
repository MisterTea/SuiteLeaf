import type JSZip from "jszip";
import type { TextRun } from "./index";
import { autofitLineFactor, autofitPointSize, normAutofitFactors } from "./pptx-autofit";
import {
  exactLineFactor,
  lastLineSpacing,
  paragraphGapPoints,
  runKern,
  runTracking,
} from "./pptx-kerning";
import { hyperlinkUsesTextColor, inheritedHyperlink } from "./pptx-hyperlink";
import {
  emptyParagraphPointSize,
  paragraphMarkBaseline,
  paragraphMarkPointSize,
  trailingBreakIsShorterMark,
} from "./pptx-paragraph-mark";
import {
  formatAutoNum,
  foldParagraphGaps,
  inheritedBulletColorXml,
  inheritedBulletPoints,
  inheritedBulletTypeface,
  pictureBulletEmbed,
  symbolBulletFont,
  symbolFontChar,
} from "./pptx-lists";
import { pictureBulletImage } from "./pptx-picture-bullet";
import { suiteLeafFont } from "./office-fonts";
import { paragraphTabStops } from "./pptx-tab-stops";
import { isSymbolFont, splitSymbolRun } from "./symbol-fonts";
import { paintColor } from "./pptx-theme";
import { runPaint } from "./pptx-run-paint";
import { officeMathRuns } from "./pptx-math";
import { decodeXmlEntities, parseXmlAttrs, type PptxPart } from "./pptx-package";

/** What a slide's text bodies inherit: the deck defaults, theme fonts and colours, and links. */
export type TextBodyScope = {
  zip: JSZip;
  width: number;
  emuWidth: number;
  defaultTextStyle: string;
  defTabPoints: number;
  scheme: Record<string, string>;
  themeFont: (name: string | undefined) => string | undefined;
  paintedSlideNumber: string;
  runHyperlink: (xml: string) => string | undefined;
  bulletHosts: PptxPart[];
  bulletImages: Map<string, string | undefined>;
};

// Helper to extract text from a txBody
export function textBodyParser({
  zip,
  width,
  emuWidth,
  defaultTextStyle,
  defTabPoints,
  scheme,
  themeFont,
  paintedSlideNumber,
  runHyperlink,
  bulletHosts,
  bulletImages,
}: TextBodyScope) {
  return async (
    txBodyXml: string,
    inherited: string[] = [],
    defaults?: { color?: string; link?: string; table?: boolean },
  ) => {
    const paragraphs: {
      text: string;
      runs: TextRun[];
      bullet?: boolean;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      size?: number;
      align?: "left" | "center" | "right" | "justify";
      distributed?: boolean;
      color?: string;
      font?: string;
      lineHeight?: number;
      lineHeightPt?: number;
      hang?: number;
      listMargin?: number;
      spaceBefore?: number;
      spaceAfter?: number;
      /** Positive first-line indent, in slide pixels. A negative indent is `hang`. */
      firstIndent?: number;
      /** Explicit tab stops, in points from the paragraph's left edge. */
      tabs?: { pos: number; align: "l" | "ctr" | "r" | "dec" }[];
      /** Default tab interval, in points, when the paragraph contains a tab. */
      tabInterval?: number;
      /** Absolute `a:spcPts` spacing; skip the single-spacing grid. */
      exactLine?: boolean;
    }[] = [];
    const fit = normAutofitFactors(txBodyXml);
    const autoCounters = new Map<string, { startAt?: number; next: number }>();
    const pRx = /<a:p\b[^>]*?(?:\/>|>[\s\S]*?<\/a:p>)/g;
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pRx.exec(txBodyXml)) !== null) {
      const pXml = pMatch[0];
      const pPrMatch = /<a:pPr\b([^>]*?)(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(
        pXml,
      );
      const ownParagraphAttrs = pPrMatch ? parseXmlAttrs(pPrMatch[1]) : {};
      const level = Number(ownParagraphAttrs.lvl || 0) + 1;
      const styleParts = [
        // A table cell does not inherit p:defaultTextStyle. That style is
        // for shapes; applying it paints body cells at the title size.
        defaults?.table ? "" : defaultTextStyle,
        ...inherited,
        /<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/.exec(txBodyXml)?.[0] || "",
      ].map(
        (xml) =>
          new RegExp(
            `<a:lvl${level}pPr\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/a:lvl${level}pPr>)`,
          ).exec(xml)?.[0] || "",
      );
      styleParts.push(pPrMatch?.[0] || "");
      const pAttrs = Object.assign(
        {},
        ...styleParts.map((xml) =>
          parseXmlAttrs(/^<[^>]+/.exec(xml)?.[0] || ""),
        ),
        ownParagraphAttrs,
      );
      const defaultRunParts = styleParts.map(
        (xml) =>
          /<a:defRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:defRPr>)/.exec(xml)?.[0] ||
          "",
      );
      const defaultRunAttrs = Object.assign(
        {},
        ...defaultRunParts.map((xml) =>
          parseXmlAttrs(/^<[^>]+/.exec(xml)?.[0] || ""),
        ),
      );
      // A later defRPr replaces the presentation default. Omitted b/i are
      // off, so defaultTextStyle bold does not leak into a plain body style.
      const specificRunAttrs = Object.assign(
        {},
        ...defaultRunParts.slice(1).map((xml) =>
          parseXmlAttrs(/^<[^>]+/.exec(xml)?.[0] || ""),
        ),
      );
      if (defaultRunParts.slice(1).some((xml) => /<a:defRPr\b/.test(xml))) {
        if (!("b" in specificRunAttrs)) delete defaultRunAttrs.b;
        if (!("i" in specificRunAttrs)) delete defaultRunAttrs.i;
      }
      const colorOf = (xml: string) => {
        const def =
          /<a:defRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:defRPr>)/.exec(xml)?.[0] ||
          "";
        // A glow, shadow, highlight, or outline is not the glyph fill.
        // A list style that only adds an effect keeps the earlier solid fill.
        const fill = def
          .replace(/<a:effectLst\b[^>]*?(?:\/>|>[\s\S]*?<\/a:effectLst>)/g, "")
          .replace(/<a:highlight\b[\s\S]*?<\/a:highlight>/g, "")
          .replace(/<a:ln\b[^>]*?(?:\/>|>[\s\S]*?<\/a:ln>)/g, "");
        return paintColor(fill, scheme);
      };
      const inheritedColor = inherited
        .map(
          (xml) =>
            colorOf(
              new RegExp(
                `<a:lvl${level}pPr\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/a:lvl${level}pPr>)`,
              ).exec(xml)?.[0] || "",
            ) || "",
        )
        .filter((color) => color)
        .at(-1);
      const ownList =
        /<a:lstStyle\b[\s\S]*?<\/a:lstStyle>/.exec(txBodyXml)?.[0] || "";
      const ownColor = [
        colorOf(
          new RegExp(
            `<a:lvl${level}pPr\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/a:lvl${level}pPr>)`,
          ).exec(ownList)?.[0] || "",
        ),
        colorOf(pPrMatch?.[0] || ""),
      ]
        .filter((color): color is string => Boolean(color))
        .at(-1);
      // The shape's own list colour, then its fontRef, then the master style,
      // then the presentation default. otherStyle's tx1 must not cover a
      // light fontRef on a coloured shape.
      const presentationColor = colorOf(styleParts[0] || "");
      const defaultColor =
        ownColor || defaults?.color || inheritedColor || presentationColor;
      const defaultFont = defaultRunParts
        .flatMap((xml) =>
          [...xml.matchAll(/<a:latin\s+typeface="([^"]+)"/g)].map(
            (m) => m[1],
          ),
        )
        .at(-1);
      let align: "left" | "center" | "right" | "justify" = "left";
      if (pAttrs.algn === "ctr") align = "center";
      else if (pAttrs.algn === "r") align = "right";
      else if (pAttrs.algn === "just") align = "justify";
      const bulletStyle =
        styleParts
          .filter((xml) => /<a:bu(?:None|Char|AutoNum|Blip)\b/.test(xml))
          .at(-1) || "";
      const hasBullet = /<a:buChar\b|<a:buAutoNum\b|<a:buBlip\b/.test(bulletStyle);
      const bulletChar = /<a:buChar\b[^>]*\bchar="([^"]*)"/.exec(bulletStyle)?.[1];
      const specificPAttrs = Object.assign(
        {},
        ...styleParts.slice(1).map((xml) =>
          parseXmlAttrs(/^<[^>]+/.exec(xml)?.[0] || ""),
        ),
        ownParagraphAttrs,
      );
      const keepWords =
        specificPAttrs.latinLnBrk === "0" ||
        specificPAttrs.latinLnBrk === "false";
      const spacing = styleParts.join("");
      const line = lastLineSpacing(spacing);

      let pText = "";
      const textRuns: TextRun[] = [];
      let isBold = false;
      let isItalic = false;
      let isUnderline = false;
      let fontSize: number | undefined = defaultRunAttrs.sz
        ? Number(defaultRunAttrs.sz) / 100
        : undefined;
      // A list default must not keep the box larger than a run that sets sz.
      // The box font is the CSS strut, so a 24pt default clips 10pt lines.
      let sizedRun = false;
      let fontColor: string | undefined = defaultColor;
      let fontFamily: string | undefined = themeFont(defaultFont);

      // Text runs. Office math is `a14:m` / `m:oMath`, which has no `a:t`.
      const rRx =
        /<a14:m\b[\s\S]*?<\/a14:m>|<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>|<a:r\b[\s\S]*?<\/a:r>|<a:fld\b[\s\S]*?<\/a:fld>|<a:br\b[^>]*(?:\/>|>[\s\S]*?<\/a:br>)/g;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = rRx.exec(pXml)) !== null) {
        const rXml = rMatch[0];
        if (/^<a14:m\b|^<m:oMath/.test(rXml)) {
          for (const mathRun of officeMathRuns(rXml)) {
            if (!mathRun.text) continue;
            pText += mathRun.text;
            if (mathRun.bold) isBold = true;
            if (mathRun.italic) isItalic = true;
            if (mathRun.fontSize && !mathRun.baseline && !mathRun.fraction) {
              if (!sizedRun) {
                fontSize = mathRun.fontSize;
                sizedRun = true;
              } else if (fontSize === undefined) fontSize = mathRun.fontSize;
            } else if (mathRun.fontSize && fontSize === undefined) fontSize = mathRun.fontSize;
            if (mathRun.color && !fontColor) fontColor = mathRun.color;
            textRuns.push(mathRun);
          }
          continue;
        }
        if (/^<a:br\b/.test(rXml)) {
          pText += "\n";
          const sz = /<a:rPr\b[^>]*\bsz="(\d+)"/.exec(rXml)?.[1];
          const breakSize = sz ? parseInt(sz, 10) / 100 : undefined;
          textRuns.push({
            text: "\n",
            ...(breakSize && breakSize > 0 && breakSize <= 4000
              ? { fontSize: breakSize }
              : {}),
          });
          continue;
        }
        const run: TextRun = {
          text: "",
          bold: false,
          italic: false,
          underline: false,
        };
        // The a:sym face of a run's private-use characters, which the rest of its text is not in.
        let symbolChars: string | undefined;
        const tMatch = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/.exec(rXml);
        const slideField =
          /^<a:fld\b/.test(rXml) && /type="slidenum"/.test(rXml);
        if (tMatch || slideField) {
          const latinFace = /<a:latin\s+typeface="([^"]+)"/.exec(rXml)?.[1];
          const symFace = /<a:sym\b[^>]*\btypeface="([^"]+)"/.exec(rXml)?.[1];
          const t = slideField
            ? paintedSlideNumber
            : decodeXmlEntities(tMatch?.[1] || "").replace(/\r\n?/g, "\n");
          // Symbol fonts draw codes, not Unicode: the text keeps them, in the SuiteLeaf face. `a:sym`
          // names the face of the run's private-use characters only.
          if (isSymbolFont(latinFace)) run.font = suiteLeafFont(latinFace);
          else if (isSymbolFont(symFace) && /[\uF000-\uF0FF]/.test(t)) symbolChars = suiteLeafFont(symFace);
          pText += t;
          run.text = t;
        }
        const rPrMatch = /<a:rPr\b([^>]*)>/.exec(rXml);
        {
          // List styles often set u="none". That must not hide a hyperlink;
          // only the run's own underline="none" turns the link style off.
          const ownAttrs = rPrMatch ? parseXmlAttrs(rPrMatch[1]) : {};
          const rAttrs = {
            ...defaultRunAttrs,
            ...ownAttrs,
          };
          if (rAttrs.b === "1" || rAttrs.b === "true") isBold = true;
          run.bold = rAttrs.b === "1" || rAttrs.b === "true";
          run.italic = rAttrs.i === "1" || rAttrs.i === "true";
          run.underline = Boolean(rAttrs.u && rAttrs.u !== "none");
          if (rAttrs.strike === "sngStrike" || rAttrs.strike === "dblStrike") run.strike = true;
          if (rAttrs.i === "1" || rAttrs.i === "true") isItalic = true;
          if (rAttrs.u && rAttrs.u !== "none") isUnderline = true;
          const ownSz = rPrMatch ? parseXmlAttrs(rPrMatch[1]).sz : undefined;
          const szSource = ownSz || rAttrs.sz;
          if (szSource) {
            const szPt = parseInt(szSource, 10) / 100;
            // PowerPoint display type goes up to 4000pt. A 400pt section
            // numeral is real; dropping it leaves the default 18pt off the slide.
            if (szPt > 0 && szPt <= 4000) {
              run.fontSize = szPt;
              // A subscript stores its own size and a baseline shift. That
              // size is not the paragraph strut; using it stretches every
              // line that contains a lowered index.
              const shifted = Number(ownAttrs.baseline || 0) !== 0;
              if (ownSz && !sizedRun && !shifted) {
                fontSize = szPt;
                sizedRun = true;
              } else if (fontSize === undefined) fontSize = szPt * (shifted ? 2 / 3 : 1);
            }
          }
          if (rAttrs.cap === "small" || rAttrs.cap === "all") run.caps = rAttrs.cap;
          const kern = runKern(rAttrs.kern);
          if (kern !== undefined) run.kern = kern;
          const tracking = runTracking(rAttrs.spc);
          if (tracking !== undefined) run.tracking = tracking;
          if (rAttrs.baseline) {
            const shift = Number(rAttrs.baseline) / 1000;
            if (shift) {
              run.baseline = Math.max(-1000, Math.min(1000, shift));
              // PowerPoint draws any raised or lowered run at the script
              // size, even when the run names its own sz.
              run.scriptScale = true;
            }
          }
          const latinMatch = /<a:latin\s+typeface="([^"]+)"/.exec(rXml);
          // Each run inherits its own paragraph's default face, not the first
          // paragraph's box face or a preceding run's explicit heading face.
          if (!run.font && defaultFont) run.font = themeFont(defaultFont);
          if (latinMatch && !isSymbolFont(latinMatch[1])) {
            fontFamily = themeFont(latinMatch[1]);
            // The box face is one paragraph. A run that names its own face
            // must keep it, or a later Calibri line paints in the theme Arial.
            if (fontFamily) run.font = fontFamily;
          }
          const painted = runPaint(rXml, scheme);
          const resolved =
            painted.color && painted.color !== "transparent"
              ? painted.color
              : undefined;
          if (painted.highlight) run.highlight = painted.highlight;
          if (painted.stroke && painted.strokeWidth) {
            run.stroke = painted.stroke;
            run.strokeWidth = painted.strokeWidth;
          }
          if (painted.shadow) run.shadow = painted.shadow;
          if (painted.gradient) run.gradient = painted.gradient;
          if (painted.reflection) run.reflection = painted.reflection;
          if (painted.color) {
            run.color = painted.color;
            if (resolved && !fontColor) fontColor = resolved;
          } else if (defaultColor) run.color = defaultColor;
          else if (defaults?.color) run.color = defaults.color;
          const href =
            runHyperlink(rXml) ||
            (inheritedHyperlink(defaultRunParts)
              ? runHyperlink(defaultRunParts.join(""))
              : undefined);
          if (href) run.href = href;
          if (/<a:hlinkClick\b/.test(rXml) || inheritedHyperlink(defaultRunParts)) {
            if (ownAttrs.u !== "none") {
              run.underline = true;
              isUnderline = true;
            }
            // PowerPoint paints the theme hyperlink colour. A run solidFill,
            // including the blue Google writes next to hlinkClick, does not replace it.
            // hlinkClr val="tx" is the exception: the run colour stays.
            if (defaults?.link && !hyperlinkUsesTextColor(rXml, defaultRunParts.join(""))) {
              run.color = defaults.link;
              if (!fontColor || fontColor === defaults.color || fontColor === resolved)
                fontColor = defaults.link;
            }
          }
        }
        if (keepWords && run.text && run.text !== "\n") run.unbroken = true;
        if (run.text) textRuns.push(...(symbolChars ? splitSymbolRun(run, symbolChars) : [run]));
      }
      // The line box follows the largest body run. A later 24pt quote must
      // not shrink a 28pt label on the same line, and a 10pt line must not
      // keep a 28pt list default.
      let strut: number | undefined;
      for (const run of textRuns) {
        if (!run.text || !run.text.trim() || run.text === "\n" || run.baseline || !(run.fontSize && run.fontSize > 0))
          continue;
        strut = strut == null ? run.fontSize : Math.max(strut, run.fontSize);
      }
      if (strut != null) fontSize = strut;
      else {
        // Every word is raised or lowered. PowerPoint sizes the line from
        // those runs: at the script size unless an unshifted end mark closes
        // the paragraph, which keeps the runs' stored size.
        let shiftedStrut = 0;
        for (const run of textRuns)
          if (run.text.trim() && run.baseline && run.fontSize)
            shiftedStrut = Math.max(shiftedStrut, run.fontSize);
        if (shiftedStrut) {
          const plainMark = /<a:endParaRPr\b/.test(pXml) && !paragraphMarkBaseline(pXml);
          fontSize = shiftedStrut * (plainMark ? 1 : 2 / 3);
          const firstShifted = textRuns.find((run) => run.text.trim() && run.baseline);
          if (firstShifted) firstShifted.scriptStrut = fontSize;
        }
      }
      const markPoints = paragraphMarkPointSize(pXml);
      const lastRun = textRuns[textRuns.length - 1];
      if (lastRun?.text === "\n" && pText.replace(/\n/g, "").trim()) {
        let breakPoints = lastRun.fontSize;
        if (!breakPoints) {
          for (let index = textRuns.length - 2; index >= 0; index--) {
            const earlier = textRuns[index];
            if (earlier.text === "\n") break;
            if (earlier.fontSize) {
              breakPoints = earlier.fontSize;
              break;
            }
          }
        }
        if (trailingBreakIsShorterMark(breakPoints || fontSize, markPoints)) {
          textRuns.pop();
          pText = pText.slice(0, -1);
        }
      }
      const rightTab = /<a:tab\b[^>]*\balgn="r"/.test(pPrMatch?.[0] || "");
      if (rightTab && /^\t[^\t]*$/.test(pText)) {
        align = "right";
        pText = pText.slice(1);
        const tabbed = textRuns.find((run) => run.text.startsWith("\t"));
        if (tabbed) tabbed.text = tabbed.text.replace(/^\t/, "");
      }
      // Shrink-to-fit scales every run. Percentage bullets then follow the
      // fitted size; an absolute buSzPts marker stays in points.
      if (fit.font !== 1) {
        if (fontSize) fontSize = autofitPointSize(fontSize, fit.font);
        for (const run of textRuns) {
          if (run.fontSize) run.fontSize = autofitPointSize(run.fontSize, fit.font);
          if (run.scriptStrut) run.scriptStrut = autofitPointSize(run.scriptStrut, fit.font);
        }
      }
      const autoTag = /<a:buAutoNum\b([^>]*)\/?>/.exec(bulletStyle);
      // A paragraph that is not numbered ends the sequence, including an
      // empty buNone between items. PowerPoint starts the next list at 1.
      if (!autoTag) {
        for (const key of autoCounters.keys()) {
          if (key.startsWith(`${level}:`)) autoCounters.delete(key);
        }
      }
      if (autoTag && pText) {
        const attrs = parseXmlAttrs(autoTag[1]);
        const kind = attrs.type || "arabicPeriod";
        const startAt = attrs.startAt ? Number(attrs.startAt) : undefined;
        const key = `${level}:${kind}`;
        let sequence = autoCounters.get(key);
        if (
          !sequence ||
          (startAt !== undefined && startAt !== sequence.startAt)
        ) {
          sequence = {
            startAt,
            next: startAt && startAt > 0 ? startAt : 1,
          };
          autoCounters.set(key, sequence);
        }
        const marker = `${formatAutoNum(kind, sequence.next)}${/^\s/u.test(pText) ? "" : " "}`;
        sequence.next += 1;
        pText = marker + pText;
        const first = textRuns.find((run) => run.text && run.text !== "\n");
        const firstRunXml =
          /<a:r\b[\s\S]*?<\/a:r>|<a:fld\b[\s\S]*?<\/a:fld>/.exec(pXml)?.[0] || "";
        const bulletColor = paintColor(inheritedBulletColorXml(styleParts), scheme);
        const bulletSize = inheritedBulletPoints(styleParts, fontSize);
        const numberFace = inheritedBulletTypeface(styleParts);
        const numberFont = symbolBulletFont(numberFace)
          ? undefined
          : themeFont(numberFace);
        const linked = /<a:hlinkClick\b/.test(firstRunXml);
        // The marker is not part of a hyperlink run. Folding it into that
        // run paints the number in the link colour and underlines it.
        if ((linked || bulletColor || bulletSize || numberFont) && first) {
          const at = textRuns.indexOf(first);
          textRuns.splice(at, 0, {
            text: marker,
            listMarker: true,
            ...(first.bold ? { bold: true } : {}),
            ...(first.italic ? { italic: true } : {}),
            ...(bulletColor || linked
              ? { color: bulletColor || defaultColor }
              : first.color
                ? { color: first.color }
                : {}),
            ...(bulletSize ? { fontSize: bulletSize } : {}),
            ...(numberFont ? { font: numberFont } : {}),
          });
        } else if (first) { first.text = marker + first.text; first.listMarker = true; }
      }
      if (bulletChar && pText) {
        const bulletFace = inheritedBulletTypeface(styleParts);
        const symbolFace = symbolBulletFont(bulletFace);
        const rawBullet = decodeXmlEntities(bulletChar);
        const marker = `${symbolFace ? symbolFontChar(rawBullet) : rawBullet}${/^\s/u.test(pText) ? "" : " "}`;
        pText = marker + pText;
        const symbol = suiteLeafFont(symbolFace || bulletFace);
        // StarSymbol draws ▪ as a square about 1.85 times the Unicode small square.
        // The face is set so the marker does not become the paragraph's strut.
        const starSquare = /starsymbol/i.test(bulletFace || "") && rawBullet === "▪";
        const bulletSize =
          inheritedBulletPoints(styleParts, fontSize) ??
          (starSquare && fontSize ? Math.round(fontSize * 1.85 * 100) / 100 : undefined);
        const bulletColor = starSquare
          ? "#000000"
          : paintColor(inheritedBulletColorXml(styleParts), scheme);
        const first = textRuns.find((run) => run.text && run.text !== "\n");
        if (symbol || bulletSize || bulletColor) {
          // Ordinary bullet fonts still use the words' paint when buClrTx is
          // stored. A separate marker must not inherit the box's theme color.
          const markerColor = bulletColor || first?.color;
          const bulletRun: TextRun = {
            text: marker,
            ...(symbol ? { font: symbol } : starSquare ? { font: suiteLeafFont("Calibri") } : {}),
            ...(bulletSize ? { fontSize: bulletSize } : {}),
            ...(markerColor ? { color: markerColor } : {}),
          };
          const at = first ? textRuns.indexOf(first) : textRuns.length;
          textRuns.splice(at, 0, bulletRun);
        } else if (first) first.text = marker + first.text;
      }
      const blipId = pictureBulletEmbed(styleParts);
      if (blipId && pText && !bulletChar && !autoTag) {
        let src = bulletImages.get(blipId);
        if (src === undefined && !bulletImages.has(blipId)) {
          src = await pictureBulletImage(zip, blipId, bulletHosts);
          bulletImages.set(blipId, src);
        }
        const marker = /^\s/u.test(pText) ? "•" : "• ";
        pText = marker + pText;
        const bulletSize = inheritedBulletPoints(styleParts, fontSize) || fontSize;
        const bulletRun: TextRun = {
          text: marker,
          ...(src ? { bulletSrc: src } : {}),
          ...(bulletSize ? { fontSize: bulletSize } : {}),
        };
        const first = textRuns.find((run) => run.text && run.text !== "\n");
        const at = first ? textRuns.indexOf(first) : textRuns.length;
        textRuns.splice(at, 0, bulletRun);
      }

      {
        const indent = Number(pAttrs.indent || 0);
        const margin = Number(pAttrs.marL || 0);
        const px = (emu: number) => (emu / emuWidth) * width;
        const hang = indent < 0 ? px(-indent) : undefined;
        const firstIndent = indent > 0 ? px(indent) : undefined;
        const firstLine = margin + Math.min(0, indent);
        const tabs = paragraphTabStops(pPrMatch?.[0] || "", (emu) => (emu / 914400) * 72);
        const slidePoints = (points: number | undefined) =>
          points
            ? (points / 72) * (width / (emuWidth / 914400))
            : undefined;
        let spacingPt: number | undefined;
        // A tab or space is a run, so its size, not the end mark, is the line.
        if (!pText.replace(/\n/g, "")) {
          const marked = emptyParagraphPointSize(pXml);
          const inheritedShift = Number(defaultRunAttrs.baseline || 0) / 1000;
          // An empty end mark inherits the paragraph default. A subscript
          // default, or a mark that still carries a baseline, is drawn at
          // the script size. Percentage space-before keeps the full size.
          const shifted = paragraphMarkBaseline(pXml) || (!marked && inheritedShift);
          // The paragraph size is already fitted. The end mark's is not.
          const fitted = marked ? autofitPointSize(marked, fit.font) : fontSize;
          if (fitted) {
            spacingPt = fitted;
            fontSize = spacingPt * (shifted ? 2 / 3 : 1);
          }
        }
        // The paragraph mark sizes the empty line after a hard break. A
        // larger mark on a line that already has words does not stretch
        // those words. Shrink-to-fit scales that empty line too.
        const markSize = paragraphMarkPointSize(pXml);
        const fittedMark = markSize ? autofitPointSize(markSize, fit.font) : undefined;
        if (fittedMark) {
          let lineSize = 0;
          for (const run of textRuns) {
            if (run.text === "\n") lineSize = 0;
            else if (run.fontSize) lineSize = Math.max(lineSize, run.fontSize);
          }
          if (lineSize === 0 && textRuns.some((run) => run.text === "\n"))
            textRuns.push({ text: "\u200b", fontSize: fittedMark });
        }
        const gapPt =
          spacingPt ||
          fontSize ||
          autofitPointSize(Number(defaultRunAttrs.sz || 0) / 100 || 18, fit.font);
        // Point paragraph gaps remain authored distances; percentage gaps
        // already use the fitted font size. Neither follows line reduction.
        const spaceBefore = slidePoints(paragraphGapPoints(spacing, "spcBef", gapPt));
        const spaceAfter = slidePoints(paragraphGapPoints(spacing, "spcAft", gapPt));
        const exact =
          line?.kind === "pts"
            ? exactLineFactor(line.value, fontSize || gapPt)
            : undefined;
        const percent = autofitLineFactor(
          line?.kind === "pct" ? line.value : undefined,
          fit.reduction,
          line?.kind === "pts",
        );
        // Display equations carry their own paragraph justification in OMML.
        // Apply it only to a purely mathematical paragraph, not surrounding prose.
        const mathAlign = /<m:jc\b[^>]*\bm:val="([^"]+)"/.exec(pXml)?.[1];
        if (textRuns.some((run) => run.math) && textRuns.every((run) => run.math || !run.text.trim())) {
          if (mathAlign === "center" || mathAlign === "centerGroup") align = "center";
          else if (mathAlign === "left" || mathAlign === "right") align = mathAlign;
        }
        paragraphs.push({
          text: pText,
          runs: textRuns.filter((run) => run.text),
          bullet: hasBullet,
          bold: isBold,
          italic: isItalic,
          underline: isUnderline,
          size: fontSize,
          align,
          ...(pAttrs.algn === "dist" ? { distributed: true } : {}),
          color: fontColor,
          font: fontFamily,
          ...(hang ? { hang } : {}),
          ...(firstIndent ? { firstIndent } : {}),
          ...(firstLine > 0 ? { listMargin: px(firstLine) } : {}),
          ...(tabs.length ? { tabs } : {}),
          ...(pText.includes("\t")
            ? {
                tabInterval:
                  Number(pAttrs.defTabSz) > 0
                    ? (Number(pAttrs.defTabSz) / 914400) * 72
                    : defTabPoints,
              }
            : {}),
          ...(spaceBefore ? { spaceBefore } : {}),
          ...(spaceAfter ? { spaceAfter } : {}),
          ...(exact
            ? { lineHeight: exact, lineHeightPt: Number(line!.value) / 100, exactLine: true as const }
            : percent != null && (line?.kind === "pct" || fit.reduction > 0)
              ? { lineHeight: percent }
              : {}),
        });
      }
    }
    return foldParagraphGaps(
      paragraphs,
      /<a:bodyPr\b[^>]*\bspcFirstLastPara="(?:1|true)"/.test(txBodyXml),
    );
  };
}

import * as CFB from "cfb";
import {
  createFile,
  type SlideFile,
  type Slide,
  type SlideElement,
} from "./index";

// Extract printable strings from raw buffer when files are corrupted or non-standard
export function extractRawStrings(buf: Uint8Array, minLen = 4): string[] {
  const result: string[] = [];
  // 1. ASCII / UTF-8
  let curr = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 32 && c <= 126) {
      curr += String.fromCharCode(c);
    } else {
      if (
        curr.length >= minLen &&
        !curr.startsWith("http://schemas.") &&
        !curr.startsWith("application/")
      ) {
        result.push(curr);
      }
      curr = "";
    }
  }
  if (curr.length >= minLen) result.push(curr);

  // 2. UTF-16LE
  curr = "";
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8);
    if (code >= 32 && code <= 126) {
      curr += String.fromCharCode(code);
    } else {
      if (
        curr.length >= minLen &&
        !curr.startsWith("http://schemas.") &&
        !curr.startsWith("application/")
      ) {
        result.push(curr);
      }
      curr = "";
    }
  }
  if (curr.length >= minLen) result.push(curr);

  // Deduplicate and filter out XML tags / internal junk
  const clean = result
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length >= minLen &&
        !/^<[^>]+>$/.test(s) &&
        !/^[0-9a-fA-F-]{20,}$/.test(s),
    );
  return Array.from(new Set(clean));
}

// Parse legacy binary PPT (.ppt) via CFB
export function parseBinaryPpt(u8: Uint8Array, defaultTitle: string): SlideFile {
  const cfb = CFB.read(u8, { type: "buffer" });
  const docEntry = CFB.find(cfb, "PowerPoint Document");
  const out = createFile("slide", defaultTitle) as SlideFile;

  if (!docEntry || !docEntry.content) {
    const rawStrings = extractRawStrings(u8);
    if (rawStrings.length > 0) {
      const slideId = out.content.slideOrder[0];
      out.content.slides[slideId].elements = [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 60,
          y: 60,
          width: 840,
          height: 420,
          content: rawStrings.slice(0, 30).join("\n"),
          fontSize: 18,
          align: "left",
        },
      ];
    }
    return out;
  }

  const data = Buffer.isBuffer(docEntry.content)
    ? docEntry.content
    : Buffer.from(docEntry.content);

  // Parse records from PowerPoint Document stream
  // [MS-PPT] records
  const slideTexts: { text: string; isNote?: boolean }[][] = [];
  let currentSlideTexts: { text: string; isNote?: boolean }[] = [];

  let pos = 0;
  while (pos + 8 <= data.length) {
    const verInst = data.readUInt16LE(pos);
    const recType = data.readUInt16LE(pos + 2);
    const recLen = data.readUInt32LE(pos + 4);
    const isContainer = (verInst & 0x0f) === 0x0f;

    // SlideContainer = 3998
    if (recType === 3998) {
      if (currentSlideTexts.length > 0) {
        slideTexts.push(currentSlideTexts);
      }
      currentSlideTexts = [];
    }

    // TextCharsAtom = 4008 (UTF-16LE characters)
    if (recType === 4008 && pos + 8 + recLen <= data.length) {
      const raw = data.slice(pos + 8, pos + 8 + recLen);
      // Check if it's UTF-16LE or ASCII
      let str = "";
      if (raw.length % 2 === 0 && raw.some((b, i) => i % 2 === 1 && b === 0)) {
        str = raw.toString("utf16le");
      } else {
        str = raw.toString("latin1");
      }
      str = str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
      if (str.length > 0) {
        currentSlideTexts.push({ text: str });
      }
    }

    // TextBytesAtom = 4000 (1-byte Latin1 / ANSI characters)
    if (recType === 4000 && pos + 8 + recLen <= data.length) {
      const raw = data.slice(pos + 8, pos + 8 + recLen);
      let str = "";
      if (raw.length >= 2 && raw.some((b, i) => i % 2 === 1 && b === 0)) {
        str = raw.toString("utf16le");
      } else {
        str = raw.toString("latin1");
      }
      str = str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
      if (str.length > 0) {
        currentSlideTexts.push({ text: str });
      }
    }

    if (isContainer) {
      pos += 8;
    } else {
      pos += 8 + recLen;
    }
  }

  if (currentSlideTexts.length > 0) {
    slideTexts.push(currentSlideTexts);
  }

  if (slideTexts.length === 0) {
    const rawStrings = extractRawStrings(u8);
    if (rawStrings.length > 0) {
      const slideId = out.content.slideOrder[0];
      out.content.slides[slideId].elements = [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 60,
          y: 60,
          width: 840,
          height: 420,
          content: rawStrings.slice(0, 30).join("\n"),
          fontSize: 18,
          align: "left",
        },
      ];
    }
    return out;
  }

  const slides: Record<string, Slide> = {};
  const slideOrder: string[] = [];

  for (let i = 0; i < slideTexts.length; i++) {
    const texts = slideTexts[i];
    const slideId = crypto.randomUUID();
    const title = texts[0]?.text || `Slide ${i + 1}`;
    const bodyTexts = texts.slice(1);

    const elements: SlideElement[] = [
      {
        id: crypto.randomUUID(),
        type: "text",
        x: 80,
        y: 60,
        width: 800,
        height: 80,
        content: title,
        fontSize: i === 0 ? 38 : 28,
        bold: true,
        align: i === 0 ? "center" : "left",
        color: "#1e293b",
      },
    ];

    if (bodyTexts.length > 0) {
      elements.push({
        id: crypto.randomUUID(),
        type: "text",
        x: 80,
        y: 160,
        width: 800,
        height: 320,
        content: bodyTexts.map((t) => t.text).join("\n\n"),
        fontSize: 18,
        bullet: true,
        align: "left",
        color: "#334155",
      });
    }

    slides[slideId] = {
      id: slideId,
      title,
      layout: i === 0 ? "title" : "title-body",
      elements,
      notes: "",
    };
    slideOrder.push(slideId);
  }

  out.content.slides = slides;
  out.content.slideOrder = slideOrder;
  return out;
}

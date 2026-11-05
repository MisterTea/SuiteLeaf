import { existsSync, readFileSync } from "node:fs";
import * as CFB from "cfb";
import { describe, expect, it } from "vitest";
import { extractDocParagraphs, importBinaryDoc, wordBinaryEncrypted } from "../packages/core/src/doc-binary";
import { OfficeImportError } from "../packages/core/src/office";
import { openOfficeReader } from "../packages/core/src/open-office";

/** A compound file holding a WordDocument stream whose FIB starts with `magic` and `flags`. */
function wordBinary(magic: number, flags: number, size = 64): Uint8Array {
  const word = new Uint8Array(size);
  word[0] = magic & 0xff;
  word[1] = magic >> 8;
  word[0x0a] = flags & 0xff;
  word[0x0b] = flags >> 8;
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "/WordDocument", word);
  return new Uint8Array(CFB.write(cfb, { type: "array" }) as number[]);
}

const refused = (bytes: Uint8Array) => {
  try {
    extractDocParagraphs(bytes);
  } catch (error) {
    return error instanceof OfficeImportError ? error.code : "other";
  }
  return "read";
};

describe("legacy Word binaries", () => {
  it("reads the encrypted and obfuscated flags from the file header", () => {
    expect(wordBinaryEncrypted(Uint8Array.from([0xec, 0xa5, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x01]))).toBe(true);
    expect(wordBinaryEncrypted(Uint8Array.from([0xec, 0xa5, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x80]))).toBe(true);
    expect(wordBinaryEncrypted(Uint8Array.from([0xdc, 0xa5, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x01]))).toBe(true);
    // Word 95's 0x8000 bit is not obfuscation.
    expect(wordBinaryEncrypted(Uint8Array.from([0xdc, 0xa5, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x80]))).toBe(false);
    expect(wordBinaryEncrypted(Uint8Array.from([0xec, 0xa5, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x02]))).toBe(false);
    expect(wordBinaryEncrypted(Uint8Array.from([0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x01]))).toBe(false);
    expect(wordBinaryEncrypted(new Uint8Array(4))).toBe(false);
  });

  it("refuses a password-protected, non-Word, or damaged file and leaves the bytes alone", () => {
    const locked = wordBinary(0xa5ec, 0x0100);
    const copy = locked.slice();
    expect(refused(locked)).toBe("encrypted");
    expect(locked).toEqual(copy);
    expect(refused(new TextEncoder().encode("not a compound file"))).toBe("invalid-container");
    const other = CFB.utils.cfb_new();
    CFB.utils.cfb_add(other, "/Workbook", new Uint8Array(8));
    expect(refused(new Uint8Array(CFB.write(other, { type: "array" }) as number[]))).toBe("invalid-container");
    // A header that claims a piece table past the end of the stream.
    const broken = new Uint8Array(64);
    broken.set([0xec, 0xa5], 0);
    broken.set([0xff, 0xff], 0x20);
    const cfb = CFB.utils.cfb_new();
    CFB.utils.cfb_add(cfb, "/WordDocument", broken);
    CFB.utils.cfb_add(cfb, "/0Table", new Uint8Array(4));
    expect(["read", "invalid-container"]).toContain(refused(new Uint8Array(CFB.write(cfb, { type: "array" }) as number[])));
  });

  /** A Word binary whose text sits between fcMin (0x18) and fcMac (0x1c). */
  function rangeBinary(magic: number, text: Uint8Array, table?: Uint8Array): Uint8Array {
    const word = new Uint8Array(0x40 + text.length);
    word.set([magic & 0xff, magic >> 8], 0);
    new DataView(word.buffer).setUint32(0x18, 0x40, true);
    new DataView(word.buffer).setUint32(0x1c, 0x40 + text.length, true);
    word.set(text, 0x40);
    const cfb = CFB.utils.cfb_new();
    CFB.utils.cfb_add(cfb, "/WordDocument", word);
    if (table) CFB.utils.cfb_add(cfb, "/0Table", table);
    return new Uint8Array(CFB.write(cfb, { type: "array" }) as number[]);
  }

  it("reads Word 95 text and falls back to a UTF-16 scan when the piece table is missing or unusable", () => {
    expect(extractDocParagraphs(rangeBinary(0xa5dc, new TextEncoder().encode("Beds\rPaths")))).toEqual(["Beds", "Paths"]);
    const utf16 = new Uint8Array(Buffer.from("North\rSouth", "utf16le"));
    expect(extractDocParagraphs(rangeBinary(0xa5ec, utf16))).toEqual(["North", "South"]);
    expect(extractDocParagraphs(rangeBinary(0xa5ec, utf16, new Uint8Array(8)))).toEqual(["North", "South"]);
    // An unknown header and a range past the end read as no text.
    expect(extractDocParagraphs(rangeBinary(0x1234, utf16))).toEqual([]);
    const past = rangeBinary(0xa5dc, new Uint8Array(0));
    expect(extractDocParagraphs(past)).toEqual([]);
    expect(extractDocParagraphs(wordBinary(0xa5ec, 0, 16))).toEqual([]);
  });

  it("reads Word 97 text through its piece table, past a formatting record", () => {
    const text = new TextEncoder().encode("Beds\rPaths");
    const word = new Uint8Array(0x140 + text.length);
    const view = new DataView(word.buffer);
    word.set([0xec, 0xa5], 0);
    view.setUint16(0x20, 0, true); // csw
    view.setUint16(0x22, 0, true); // cslw
    view.setUint16(0x24, 34, true); // pairs in the FIB
    const clx = new Uint8Array(3 + 1 + 4 + 16);
    const c = new DataView(clx.buffer);
    clx[0] = 1; // a property record of length 0, skipped
    c.setUint16(1, 0, true);
    clx[3] = 2; // the piece table
    c.setUint32(4, 16, true);
    c.setUint32(8, 0, true);
    c.setUint32(12, text.length, true);
    c.setUint32(16 + 2, 0x40000000 | (0x140 * 2), true); // a compressed piece at 0x140
    view.setUint32(0x26 + 33 * 8, 0, true); // fcClx
    view.setUint32(0x26 + 33 * 8 + 4, clx.length, true); // lcbClx
    word.set(text, 0x140);
    const cfb = CFB.utils.cfb_new();
    CFB.utils.cfb_add(cfb, "/WordDocument", word);
    CFB.utils.cfb_add(cfb, "/0Table", clx);
    expect(extractDocParagraphs(new Uint8Array(CFB.write(cfb, { type: "array" }) as number[]))).toEqual(["Beds", "Paths"]);
  });

  it("says so when a readable file has no text", () => {
    const file = importBinaryDoc(wordBinary(0xa5ec, 0), "doc", "Empty.doc");
    expect(file.importInfo?.warnings).toContain(
      "No text could be read from this Word 97–2003 file, so the document is empty. The original file is unchanged.",
    );
  });

  const corpus = "datasets/apache-poi/files/test-data/document";
  for (const name of ["PasswordProtected.doc", "password_password_cryptoapi.doc", "password_tika_binaryrc4.doc"]) {
    it.skipIf(!existsSync(`${corpus}/${name}`))(`refuses ${name} as encrypted`, async () => {
      await expect(openOfficeReader(readFileSync(`${corpus}/${name}`), "doc", name)).rejects.toMatchObject({ code: "encrypted" });
    });
  }
  const protectedOnly = "datasets/libreoffice/files/sw/qa/extras/uiwriter/data/tdf132637_protectTrackChanges.doc";
  it.skipIf(!existsSync(protectedOnly))("opens a file that is only protected against edits", async () => {
    const { file } = await openOfficeReader(readFileSync(protectedOnly), "doc", "x.doc");
    expect(file.kind).toBe("doc");
  });
});

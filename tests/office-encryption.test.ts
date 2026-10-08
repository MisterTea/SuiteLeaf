import { describe, expect, it } from "vitest";
import { createCipheriv, createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as CFB from "cfb";
import JSZip from "jszip";
import { importOffice, OFFICE_INPUT_LIMIT } from "../packages/core/src/office";
import { decryptOfficePackage } from "../packages/core/src/office-encryption";
import { excelFixture } from "./office-fixtures";

// Independently generated encrypted package using Node crypto, not the production decryptor.
function encryptedFixture(
  plain: Uint8Array,
  hashName = "SHA512",
  keyBits = 256,
) {
  const password = "Tést🔒";
  const salt = Buffer.alloc(16, 1),
    dataSalt = Buffer.alloc(16, 2);
  const secret = Buffer.alloc(keyBits / 8, 3),
    verifier = Buffer.alloc(16, 4);
  const hash = (value: Uint8Array) =>
    createHash(hashName.toLowerCase()).update(value).digest();
  let digest = hash(Buffer.concat([salt, Buffer.from(password, "utf16le")]));
  for (let i = 0; i < 100; i++) {
    const iterator = Buffer.alloc(4);
    iterator.writeUInt32LE(i);
    digest = hash(Buffer.concat([iterator, digest]));
  }
  const fit = (value: Uint8Array, length: number) => {
    const result = Buffer.alloc(length, 0x36);
    Buffer.from(value).copy(result, 0, 0, length);
    return result;
  };
  const key = (block: number[]) =>
    fit(hash(Buffer.concat([digest, Buffer.from(block)])), keyBits / 8);
  const encrypt = (value: Uint8Array, key: Uint8Array, iv: Uint8Array) => {
    const padded = Buffer.alloc(Math.ceil(value.length / 16) * 16);
    Buffer.from(value).copy(padded);
    const cipher = createCipheriv(`aes-${keyBits}-cbc`, key, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(padded), cipher.final()]);
  };
  const encoded = (value: Uint8Array) => Buffer.from(value).toString("base64");
  const dataIV = (block: Uint8Array) =>
    hash(Buffer.concat([dataSalt, block])).subarray(0, 16);
  const chunks: Buffer[] = [];
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(plain.length));
  chunks.push(size);
  for (let offset = 0, i = 0; offset < plain.length; offset += 4096, i++) {
    const block = Buffer.alloc(4);
    block.writeUInt32LE(i);
    chunks.push(
      encrypt(plain.subarray(offset, offset + 4096), secret, dataIV(block)),
    );
  }
  const payload = Buffer.concat(chunks);
  // Agile stores a padded key in some producers; only hashSize bytes are the
  // actual HMAC key. Keep extra bytes here to catch accidental full-block use.
  const hmacKey = Buffer.alloc(hash(Buffer.alloc(0)).length + 16, 5);
  const tag = createHmac(
    hashName.toLowerCase(),
    hmacKey.subarray(0, hash(Buffer.alloc(0)).length),
  )
    .update(payload)
    .digest();
  const common = `saltSize="16" blockSize="16" keyBits="${keyBits}" hashSize="${tag.length}" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="${hashName}"`;
  const xml = `<encryption><keyData ${common} saltValue="${encoded(dataSalt)}"/><dataIntegrity encryptedHmacKey="${encoded(encrypt(hmacKey, secret, dataIV(Buffer.from([0x5f, 0xb2, 0xad, 1, 0xc, 0xb9, 0xe1, 0xf6]))))}" encryptedHmacValue="${encoded(encrypt(tag, secret, dataIV(Buffer.from([0xa0, 0x67, 0x7f, 2, 0xb2, 0x2c, 0x84, 0x33]))))}"/><keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password"><encryptedKey ${common} spinCount="100" saltValue="${encoded(salt)}" encryptedVerifierHashInput="${encoded(encrypt(verifier, key([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]), salt))}" encryptedVerifierHashValue="${encoded(encrypt(hash(verifier), key([0xd7, 0xaa, 0xf, 0x6d, 0x30, 0x61, 0x34, 0x4e]), salt))}" encryptedKeyValue="${encoded(encrypt(secret, key([0x14, 0x6e, 0xb, 0xe7, 0xab, 0xac, 0xd0, 0xd6]), salt))}"/></keyEncryptor></keyEncryptors></encryption>`;
  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(
    container,
    "EncryptionInfo",
    Buffer.concat([Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]), Buffer.from(xml)]),
  );
  CFB.utils.cfb_add(container, "EncryptedPackage", payload);
  return {
    bytes: new Uint8Array(CFB.write(container, { type: "buffer" })),
    password,
  };
}
function changePayload(
  bytes: Uint8Array,
  update: (payload: Uint8Array) => void,
) {
  const c = CFB.read(bytes, { type: "array" });
  const f = c.FileIndex.find((v) => v.name === "EncryptedPackage")!;
  const payload = new Uint8Array(f.content);
  update(payload);
  f.content = payload;
  return new Uint8Array(CFB.write(c, { type: "buffer" }));
}
describe("Office Agile password imports", () => {
  it.skipIf(
    !existsSync(
      "datasets/napierone/files/xlsx-password/0001-xlsx-password.xlsx",
    ),
  )(
    "opens the original documented encrypted workbook without changing its bytes",
    async () => {
      const bytes = new Uint8Array(
        readFileSync(
          "datasets/napierone/files/xlsx-password/0001-xlsx-password.xlsx",
        ),
      );
      const original = bytes.slice();
      const result = await importOffice(
        bytes,
        "xlsx",
        "0001-xlsx-password.xlsx",
        { password: "napierone" },
      );
      expect(result.file.kind).toBe("sheet");
      if (result.file.kind === "sheet") {
        expect(result.file.content.workbook.sheetOrder).toHaveLength(3);
        const boxes = result.file.content.images!.filter((i) =>
          i.id.startsWith("excel-textbox-"),
        );
        expect(boxes).toHaveLength(2);
        const first = Buffer.from(
          boxes[0].src.split(",")[1],
          "base64",
        ).toString();
        expect(first).toContain("UK Biodiversity Indicators 2015");
        expect(first).toContain(" on UK and international biodiversity");
        expect(first).toContain("http://jncc.defra.gov.uk/page-4251");
        expect(
          Buffer.from(boxes[1].src.split(",")[1], "base64").toString(),
        ).toContain("http://jncc.defra.gov.uk/page-1824");
      }
      expect(() => decryptOfficePackage(bytes, "incorrect")).toThrow(
        expect.objectContaining({ code: "wrong-password" }),
      );
      expect(() =>
        decryptOfficePackage(
          changePayload(bytes, (payload) => {
            payload[24] ^= 0x40;
          }),
          "napierone",
        ),
      ).toThrow(/integrity check failed/);
      expect(bytes).toEqual(original);
    },
  );
  it.each([
    ["SHA512", 256],
    ["SHA384", 192],
    ["SHA256", 128],
    ["SHA1", 256],
  ] as const)(
    "decrypts %s/AES%s including multiple segments and unicode passwords",
    (hash, bits) => {
      const plain = new Uint8Array(8507).map((_, i) => i % 253),
        fixture = encryptedFixture(plain, hash, bits);
      expect(decryptOfficePackage(fixture.bytes, fixture.password)).toEqual(
        plain,
      );
    },
  );
  it("requests a password, rejects a wrong password, and does not mutate the source", () => {
    const { bytes, password } = encryptedFixture(new Uint8Array(32));
    const original = bytes.slice();
    expect(() => decryptOfficePackage(bytes)).toThrow(
      expect.objectContaining({ code: "encrypted" }),
    );
    expect(() => decryptOfficePackage(bytes, "wrong")).toThrow(
      expect.objectContaining({ code: "wrong-password" }),
    );
    decryptOfficePackage(bytes, password);
    expect(bytes).toEqual(original);
  });
  it("rejects payload tampering and oversized plaintext declarations", () => {
    const f = encryptedFixture(new Uint8Array(32));
    expect(() =>
      decryptOfficePackage(
        changePayload(f.bytes, (p) => {
          p[20] ^= 1;
        }),
        f.password,
      ),
    ).toThrow(/integrity check failed/);
    const oversized = changePayload(f.bytes, (p) =>
      new DataView(p.buffer, p.byteOffset, p.byteLength).setBigUint64(
        0,
        BigInt(OFFICE_INPUT_LIMIT + 1),
        true,
      ),
    );
    expect(() => decryptOfficePackage(oversized, f.password)).toThrow(
      expect.objectContaining({ code: "input-limit" }),
    );
  });
  it("rejects excessive password spin counts before deriving a key", () => {
    const { bytes, password } = encryptedFixture(new Uint8Array(32));
    const container = CFB.read(bytes, { type: "array" });
    const info = container.FileIndex.find(
      (entry) => entry.name === "EncryptionInfo",
    )!;
    const content = Buffer.from(info.content);
    const xml = content
      .subarray(8)
      .toString("utf8")
      .replace('spinCount="100"', 'spinCount="1000001"');
    info.content = Buffer.concat([content.subarray(0, 8), Buffer.from(xml)]);
    info.size = info.content.length;
    const excessive = new Uint8Array(CFB.write(container, { type: "buffer" }));
    expect(() => decryptOfficePackage(excessive, password)).toThrow(
      /encryption parameters/,
    );
  });
  it("runs decrypted packages through the existing importer and XML safety validation", async () => {
    const original = await excelFixture(),
      zip = await JSZip.loadAsync(original),
      good = encryptedFixture(original);
    expect(
      (
        await importOffice(good.bytes, "xlsx", "protected.xlsx", {
          password: good.password,
        })
      ).file.kind,
    ).toBe("sheet");
    zip.file(
      "xl/workbook.xml",
      '<!DOCTYPE workbook [<!ENTITY xx "secret">]><workbook/>',
    );
    const unsafe = encryptedFixture(
      await zip.generateAsync({ type: "uint8array" }),
    );
    await expect(
      importOffice(unsafe.bytes, "xlsx", "protected.xlsx", {
        password: unsafe.password,
      }),
    ).rejects.toMatchObject({ code: "unsafe-xml" });
    const missingWorkbook = await JSZip.loadAsync(original);
    missingWorkbook.remove("xl/workbook.xml");
    const missing = encryptedFixture(
      await missingWorkbook.generateAsync({ type: "uint8array" }),
    );
    await expect(
      importOffice(missing.bytes, "xlsx", "protected.xlsx", {
        password: missing.password,
      }),
    ).rejects.toMatchObject({ code: "missing-part" });
  });
});

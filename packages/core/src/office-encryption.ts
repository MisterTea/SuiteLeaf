import * as CFB from "cfb";
import { cbc } from "@noble/ciphers/aes.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import {
  OfficeImportError,
  OFFICE_INPUT_LIMIT,
  array,
  parseXml,
} from "./office";

const blocks = {
  verifier: new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]),
  verifierHash: new Uint8Array([
    0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e,
  ]),
  key: new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]),
  integrityKey: new Uint8Array([
    0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6,
  ]),
  integrityValue: new Uint8Array([
    0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33,
  ]),
};
const hashes = { SHA1: sha1, SHA256: sha256, SHA384: sha384, SHA512: sha512 };
const invalid = (message: string): never => {
  throw new OfficeImportError("invalid-encryption", message);
};
function join(...values: Uint8Array[]) {
  const result = new Uint8Array(values.reduce((n, v) => n + v.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}
function fit(value: Uint8Array, length: number, padding = 0x36) {
  const result = new Uint8Array(length).fill(padding);
  result.set(value.subarray(0, length));
  return result;
}
function number(value: unknown, min: number, max: number) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    invalid("Invalid Office encryption parameters.");
  return n;
}
function base64(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    invalid("Invalid Office encryption data.");
  return Uint8Array.from(atob(value as string), (c) => c.charCodeAt(0));
}
function parameters(node: any) {
  if (
    !node ||
    node["@_cipherAlgorithm"] !== "AES" ||
    node["@_cipherChaining"] !== "ChainingModeCBC"
  )
    throw new OfficeImportError(
      "unsupported-encryption",
      "This Office encryption method is not supported.",
    );
  const hash = hashes[node["@_hashAlgorithm"] as keyof typeof hashes];
  if (!hash)
    throw new OfficeImportError(
      "unsupported-encryption",
      "This Office password hash method is not supported.",
    );
  const keyBits = number(node["@_keyBits"], 128, 256);
  if (
    ![128, 192, 256].includes(keyBits) ||
    number(node["@_blockSize"], 16, 16) !== 16
  )
    invalid("Invalid AES parameters.");
  const salt = base64(node["@_saltValue"]);
  if (
    salt.length !== number(node["@_saltSize"], 1, 64) ||
    number(node["@_hashSize"], 20, 64) !== hash.outputLen
  )
    invalid("Invalid Office encryption salt or hash size.");
  return { hash, keyBits, salt };
}
function decrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array) {
  if (!data.length || data.length % 16)
    invalid("Truncated Office encrypted data.");
  return cbc(key, iv, { disablePadding: true }).decrypt(data);
}
function equal(a: Uint8Array, b: Uint8Array) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ (b[i] ?? 0);
  return difference === 0;
}

/** Office Agile password decryption (MS-OFFCRYPTO 2.3.4.11–15).
 * Called in the browser converter worker. Decrypted bytes still pass Office ZIP preflight.
 */
export function decryptOfficePackage(
  bytes: Uint8Array,
  password?: string,
): Uint8Array {
  if (bytes.length > OFFICE_INPUT_LIMIT)
    throw new OfficeImportError(
      "input-limit",
      "Office imports are limited to 120 MB.",
    );
  if (bytes[0] !== 0xd0 || bytes[1] !== 0xcf) return bytes;
  let container: CFB.CFB$Container;
  try {
    container = CFB.read(bytes, { type: "array" });
  } catch {
    return bytes;
  } // Existing importer reports damaged binary containers.
  const stream = (name: string) =>
    container.FileIndex.find((entry, i) =>
      container.FullPaths[i].endsWith(`/${name}`),
    )?.content;
  const encrypted = stream("EncryptedPackage");
  if (!encrypted) return bytes; // Ordinary legacy XLS, not an encrypted OOXML wrapper.
  if (password === undefined)
    throw new OfficeImportError(
      "encrypted",
      "Enter the password to open this Office file.",
    );
  const raw = stream("EncryptionInfo");
  if (!raw || raw.length < 8 || encrypted.length < 8)
    invalid("Office encryption information is missing.");
  const info = new Uint8Array(raw!);
  const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
  if (view.getUint16(0, true) !== 4 || view.getUint16(2, true) !== 4)
    throw new OfficeImportError(
      "unsupported-encryption",
      "This Office password encryption version is not supported.",
    );
  const root = parseXml(
    new TextDecoder().decode(info.subarray(8)),
    "EncryptionInfo",
  ).encryption;
  const encryptor = array<any>(root?.keyEncryptors?.keyEncryptor).find(
    (v) =>
      v["@_uri"] ===
      "http://schemas.microsoft.com/office/2006/keyEncryptor/password",
  );
  if (!encryptor?.encryptedKey)
    throw new OfficeImportError(
      "unsupported-encryption",
      "This Office file requires a certificate instead of a password.",
    );
  const node = encryptor.encryptedKey;
  const p = parameters(node),
    data = parameters(root.keyData);
  // Keep hostile metadata from monopolizing the converter worker. The common
  // Office value is 100,000; one million leaves room for unusual files.
  const spin = number(node["@_spinCount"], 0, 1000000);
  const utf16 = new Uint8Array(password.length * 2);
  // Preserve UTF-16 code units, including surrogate pairs.
  for (let i = 0; i < password.length; i++) {
    utf16[i * 2] = password.charCodeAt(i) & 255;
    utf16[i * 2 + 1] = password.charCodeAt(i) >>> 8;
  }
  let digest = p.hash(join(p.salt, utf16));
  utf16.fill(0);
  const iteration = new Uint8Array(4 + digest.length),
    iterationView = new DataView(iteration.buffer);
  for (let i = 0; i < spin; i++) {
    iterationView.setUint32(0, i, true);
    iteration.set(digest, 4);
    digest = p.hash(iteration);
  }
  const key = (block: Uint8Array) =>
    fit(p.hash(join(digest, block)), p.keyBits / 8);
  const iv = fit(p.salt, 16);
  const verifier = decrypt(
    base64(node["@_encryptedVerifierHashInput"]),
    key(blocks.verifier),
    iv,
  ).subarray(0, p.salt.length);
  const expected = decrypt(
    base64(node["@_encryptedVerifierHashValue"]),
    key(blocks.verifierHash),
    iv,
  ).subarray(0, p.hash.outputLen);
  if (!equal(p.hash(verifier), expected))
    throw new OfficeImportError(
      "wrong-password",
      "The password is incorrect. Try again.",
    );
  const secret = decrypt(
    base64(node["@_encryptedKeyValue"]),
    key(blocks.key),
    iv,
  ).slice(0, data.keyBits / 8);
  digest.fill(0);
  iteration.fill(0);
  const payload = new Uint8Array(encrypted);
  const size = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  ).getBigUint64(0, true);
  if (size > BigInt(OFFICE_INPUT_LIMIT))
    throw new OfficeImportError(
      "input-limit",
      "The decrypted Office file exceeds the 120 MB import limit.",
    );
  const length = Number(size);
  if (!length || payload.length - 8 !== Math.ceil(length / 16) * 16)
    invalid("Office encrypted package length does not match its header.");
  const integrity = root.dataIntegrity;
  if (!integrity)
    invalid("Office encrypted package integrity information is missing.");
  const dataIV = (block: Uint8Array) =>
    fit(data.hash(join(data.salt, block)), 16);
  const hmacKey = decrypt(
    base64(integrity["@_encryptedHmacKey"]),
    secret,
    dataIV(blocks.integrityKey),
  ).slice(0, data.hash.outputLen);
  const expectedHmac = decrypt(
    base64(integrity["@_encryptedHmacValue"]),
    secret,
    dataIV(blocks.integrityValue),
  ).subarray(0, data.hash.outputLen);
  try {
    if (!equal(hmac(data.hash, hmacKey, payload), expectedHmac))
      throw new OfficeImportError(
        "invalid-encryption",
        "This password-protected Office file is damaged: its integrity check failed.",
      );
    const result = new Uint8Array(length);
    for (
      let offset = 0, segment = 0;
      offset < length;
      offset += 4096, segment++
    ) {
      const block = new Uint8Array(4);
      new DataView(block.buffer).setUint32(0, segment, true);
      const end = Math.min(payload.length, 8 + offset + 4096);
      const decrypted = decrypt(
        payload.subarray(8 + offset, end),
        secret,
        dataIV(block),
      );
      result.set(
        decrypted.subarray(0, Math.min(4096, length - offset)),
        offset,
      );
      block.fill(0);
      decrypted.fill(0);
    }
    return result;
  } finally {
    secret.fill(0);
    hmacKey.fill(0);
  }
}

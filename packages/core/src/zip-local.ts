/**
 * A PowerPoint package is a zip. Some copies lose the end-of-central-directory
 * record while every local file header is still intact. JSZip then refuses the
 * file, and the importer would otherwise print archive bytes as slide text.
 * The local headers already carry each name and size, so the directory can be
 * written again without guessing at the compressed bytes.
 */

type LocalEntry = {
  offset: number;
  name: Uint8Array;
  end: number;
};

function hasEndRecord(bytes: Uint8Array): boolean {
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= start; index--) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x05 &&
      bytes[index + 3] === 0x06
    )
      return true;
  }
  return false;
}

function localEntries(bytes: Uint8Array): LocalEntry[] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: LocalEntry[] = [];
  let pos = 0;
  while (pos + 30 <= bytes.length) {
    if (view.getUint32(pos, true) !== 0x04034b50) break;
    const flags = view.getUint16(pos + 6, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const compressed = view.getUint32(pos + 18, true);
    // A data descriptor with no size, or a truncated member, ends the walk.
    if (flags & 0x0008 && compressed === 0) break;
    const end = pos + 30 + nameLen + extraLen + compressed;
    if (end > bytes.length) break;
    entries.push({
      offset: pos,
      name: bytes.subarray(pos + 30, pos + 30 + nameLen),
      end,
    });
    pos = end;
  }
  return entries.length ? entries : undefined;
}

function directoryRecord(bytes: Uint8Array, entry: LocalEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const record = new Uint8Array(46 + entry.name.length);
  const out = new DataView(record.buffer);
  out.setUint32(0, 0x02014b50, true);
  out.setUint16(4, 20, true);
  out.setUint16(6, view.getUint16(entry.offset + 4, true), true);
  out.setUint16(8, view.getUint16(entry.offset + 6, true), true);
  out.setUint16(10, view.getUint16(entry.offset + 8, true), true);
  out.setUint16(12, view.getUint16(entry.offset + 10, true), true);
  out.setUint16(14, view.getUint16(entry.offset + 12, true), true);
  out.setUint32(16, view.getUint32(entry.offset + 14, true), true);
  out.setUint32(20, view.getUint32(entry.offset + 18, true), true);
  out.setUint32(24, view.getUint32(entry.offset + 22, true), true);
  out.setUint16(28, entry.name.length, true);
  out.setUint32(42, entry.offset, true);
  record.set(entry.name, 46);
  return record;
}

/**
 * Bytes JSZip can open, or undefined when the file already has an end record
 * or no complete local members.
 */
export function zipFromLocalHeaders(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes.length < 30 || hasEndRecord(bytes)) return;
  const entries = localEntries(bytes);
  if (!entries || entries.length > 0xffff) return;
  const localEnd = entries[entries.length - 1].end;
  const records = entries.map((entry) => directoryRecord(bytes, entry));
  const directorySize = records.reduce((sum, record) => sum + record.length, 0);
  const out = new Uint8Array(localEnd + directorySize + 22);
  out.set(bytes.subarray(0, localEnd), 0);
  let at = localEnd;
  for (const record of records) {
    out.set(record, at);
    at += record.length;
  }
  const end = new DataView(out.buffer, out.byteOffset + at, 22);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, localEnd, true);
  return out;
}

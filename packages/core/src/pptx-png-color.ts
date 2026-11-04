/** PowerPoint paints PNG sample values without applying their embedded ICC profile.
 * Keep the compressed pixels unchanged so browser color management does not tint screenshots. */
export function officePngSamples(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length < 8 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((v, i) => bytes[i] !== v)
  )
    return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keep: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8,
    removed = false;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) return bytes;
    const length = view.getUint32(at);
    const end = at + length + 12;
    if (end > bytes.length) return bytes;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "iCCP") removed = true;
    else keep.push(bytes.subarray(at, end));
    at = end;
  }
  if (!removed) return bytes;
  const result = new Uint8Array(
    keep.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of keep) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

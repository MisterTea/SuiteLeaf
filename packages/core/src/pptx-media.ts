/** Video and audio larger than this stay as a poster so a deck of clips can still be drawn. */
// Lecture clips run past 50 MB. A poster with no bytes leaves Play video with nothing to start.
export const INLINE_MEDIA_LIMIT = 64 * 1024 * 1024;

/** MPEG program streams do not play in the slide viewer. Keep an MP4 when ffmpeg can make one. */
export async function playableClip(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (mime !== "video/mpeg" || typeof process === "undefined" || !process.getBuiltinModule)
    return { bytes, mime };
  try {
    const { spawn } = process.getBuiltinModule("node:child_process");
    const { mkdtemp, readFile, rm, writeFile } = process.getBuiltinModule("node:fs/promises");
    const { tmpdir } = process.getBuiltinModule("node:os");
    const { join } = process.getBuiltinModule("node:path");
    const dir = await mkdtemp(join(tmpdir(), "suiteleaf-mpg-"));
    const input = join(dir, "clip.mpg");
    const output = join(dir, "clip.mp4");
    await writeFile(input, bytes);
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        ["-y", "-i", input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", output],
        { stdio: "ignore" },
      );
      child.on("error", reject);
      child.on("close", (status) => resolve(status ?? 1));
    });
    if (code !== 0) return { bytes, mime };
    const mp4 = new Uint8Array(await readFile(output));
    await rm(dir, { recursive: true, force: true });
    return { bytes: mp4, mime: "video/mp4" };
  } catch {
    return { bytes, mime };
  }
}

export function detectImageMime(buf: Uint8Array): string | null {
  const placeableWmf =
    buf.length >= 40 &&
    buf[0] === 0xd7 &&
    buf[1] === 0xcd &&
    buf[2] === 0xc6 &&
    buf[3] === 0x9a;
  const wmfOffset = placeableWmf ? 22 : 0;
  if (
    buf.length >= wmfOffset + 18 &&
    (buf[wmfOffset] === 1 || buf[wmfOffset] === 2) &&
    buf[wmfOffset + 1] === 0 &&
    buf[wmfOffset + 2] === 9 &&
    buf[wmfOffset + 3] === 0 &&
    buf[wmfOffset + 4] === 0 &&
    (buf[wmfOffset + 5] === 1 || buf[wmfOffset + 5] === 3)
  )
    return "image/wmf";
  if (
    buf.length >= 8 &&
    buf[0] === 0x49 &&
    buf[1] === 0x49 &&
    buf[2] === 0xbc &&
    buf[3] === 0x01
  )
    return "image/wdp";
  // Some producers save BMP bytes with a .png name; sniff the header.
  if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d)
    return "image/bmp";
  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0 && buf[3] === 0x2a))
  )
    return "image/tiff";
  if (
    buf.length >= 44 &&
    buf[0] === 1 &&
    buf[1] === 0 &&
    buf[2] === 0 &&
    buf[3] === 0 &&
    buf[40] === 0x20 &&
    buf[41] === 0x45 &&
    buf[42] === 0x4d &&
    buf[43] === 0x46
  )
    return "image/emf";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    buf.slice(0, 200),
  );
  if (text.includes("<svg") || text.includes("<?xml")) {
    return "image/svg+xml";
  }
  return null;
}

export function uint8ToBase64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(u8).toString("base64");
  }
  let binary = "";
  const len = u8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

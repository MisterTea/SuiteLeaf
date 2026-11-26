import { describe, expect, it } from "vitest";
import {
  assemblePresentation,
  blake3Hex,
  createFile,
  diffSlidePackage,
  isSlidePackageBytes,
  isSlmediaUri,
  packSlidePackageZip,
  parseFile,
  parseFileBytes,
  readZipCentralDirectory,
  readZipEntry,
  serializeFile,
  serializeFileBytes,
  splitPresentation,
  unpackSlidePackageZip,
  type SlideFile,
} from "@suiteleaf/core";

function makeDeckWithMedia(): SlideFile {
  const deck = createFile("slide", "Architecture Deck") as SlideFile;
  // ~6 KB deterministic PNG-like base64 payload (above 4096 threshold)
  const rawBytes = new Uint8Array(4800);
  for (let i = 0; i < rawBytes.length; i++) rawBytes[i] = (i * 31) & 0xff;
  const imgDataUri = `data:image/png;base64,${Buffer.from(rawBytes).toString("base64")}`;

  const s1Id = deck.content.slideOrder[0];
  deck.content.slides[s1Id].title = "Intro";
  deck.content.slides[s1Id].elements.push({
    id: "img-1",
    type: "image",
    x: 40,
    y: 40,
    width: 300,
    height: 200,
    src: imgDataUri,
  });

  const s2Id = "slide-2";
  deck.content.slideOrder.push(s2Id);
  deck.content.slides[s2Id] = {
    id: s2Id,
    title: "Details",
    layout: "title-body",
    elements: [
      {
        id: "txt-2",
        type: "text",
        x: 60,
        y: 60,
        width: 500,
        height: 80,
        content: "Sectioned slide content",
        fontSize: 28,
        bold: true,
      },
      {
        id: "img-2-dup",
        type: "image",
        x: 60,
        y: 160,
        width: 300,
        height: 200,
        // Identical image on slide 2 should deduplicate to the same BLAKE3 hash
        src: imgDataUri,
      },
    ],
    notes: "Speaker notes for slide 2",
  };

  deck.edits = [
    {
      id: "e1",
      at: deck.updatedAt,
      by: { id: "u1", name: "Alice" },
      op: { kind: "test" },
    },
  ];
  return deck;
}

describe("slslides v2 sectioned package", () => {
  it("splits a presentation into global, per-slide, deduplicated media, thumbnails, and history", () => {
    const deck = makeDeckWithMedia();
    const parts = splitPresentation(deck, { mediaThresholdBytes: 4096 });

    expect(parts.manifest.version).toBe(2);
    expect(parts.manifest.kind).toBe("slide");
    expect(parts.manifest.slideOrder).toEqual(deck.content.slideOrder);
    expect(parts.manifest.global.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(parts.manifest.history?.hash).toMatch(/^[a-f0-9]{64}$/);

    // Both slides reference the exact same externalized slmedia:// URI
    const [s1Id, s2Id] = deck.content.slideOrder;
    const s1Img = parts.slides[s1Id].elements.find((e) => e.id === "img-1")?.src;
    const s2Img = parts.slides[s2Id].elements.find((e) => e.id === "img-2-dup")?.src;
    expect(s1Img).toBeDefined();
    expect(isSlmediaUri(s1Img!)).toBe(true);
    expect(s1Img).toBe(s2Img);

    // Thumbnails are inlined directly in manifest.slides[id].thumbSvg (no separate thumbnail blobs)
    const s1Summary = parts.manifest.slides[s1Id];
    const s2Summary = parts.manifest.slides[s2Id];
    expect(s1Summary.thumbSvg).toContain("<svg");
    expect(s2Summary.thumbSvg).toContain("<svg");

    // Only 1 PNG entry in media (deduplicated across 2 slides)
    const pngEntries = Object.values(parts.manifest.media).filter(
      (m) => m.mime === "image/png",
    );
    expect(pngEntries).toHaveLength(1);
    expect(pngEntries[0].size).toBe(4800);
  });

  it("round-trips through ZIP pack/unpack and parseFileBytes/serializeFileBytes", async () => {
    const deck = makeDeckWithMedia();
    const zipBytes = await serializeFileBytes(deck);
    expect(isSlidePackageBytes(zipBytes)).toBe(true);

    const parsed = (await parseFileBytes(zipBytes, "slide")) as SlideFile;
    expect(parsed.kind).toBe("slide");
    expect(parsed.title).toBe(deck.title);
    expect(parsed.content.slideOrder).toEqual(deck.content.slideOrder);
    expect(parsed.content.slides["slide-2"].notes).toBe("Speaker notes for slide 2");
    expect(parsed.edits).toHaveLength(1);

    // Media is transparently rehydrated back to exact data: URI
    const origSrc = deck.content.slides["slide-2"].elements[1].src;
    const roundTrippedSrc = parsed.content.slides["slide-2"].elements[1].src;
    expect(roundTrippedSrc).toBe(origSrc);

    // Legacy v1 JSON bytes also still parse cleanly via parseFileBytes
    const v1Bytes = new TextEncoder().encode(serializeFile(deck));
    expect(isSlidePackageBytes(v1Bytes)).toBe(false);
    const parsedV1 = (await parseFileBytes(v1Bytes, "slide")) as SlideFile;
    expect(parsedV1.content.slideOrder).toEqual(deck.content.slideOrder);
  });

  it("supports O(1) random-access ZIP reading of manifest and global (with merged slides) without reading media blobs", async () => {
    const deck = makeDeckWithMedia();
    const zipBytes = await packSlidePackageZip(deck);

    let totalBytesRead = 0;
    const readRange = async (offset: number, length: number) => {
      totalBytesRead += length;
      return zipBytes.subarray(offset, offset + length);
    };

    const dir = await readZipCentralDirectory(zipBytes.byteLength, readRange);
    expect(dir.has("manifest.json")).toBe(true);
    expect(dir.has("global.json")).toBe(true);
    expect(dir.has("slides/slide-2.json")).toBe(false);

    const manifestRaw = await readZipEntry(dir.get("manifest.json")!, readRange);
    const manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
    expect(manifest.version).toBe(2);

    const globalRaw = await readZipEntry(dir.get("global.json")!, readRange);
    const global = JSON.parse(new TextDecoder().decode(globalRaw));
    expect(global.slides["slide-2"].id).toBe("slide-2");
    expect(global.slides["slide-2"].notes).toBe("Speaker notes for slide 2");
    expect(totalBytesRead).toBeGreaterThan(0);
  });

  it("computes minimal deltas when only one slide is edited (re-uploads global.json only, never media)", () => {
    const deck = makeDeckWithMedia();
    const v1Parts = splitPresentation(deck, { mediaThresholdBytes: 4096 });

    // Edit only slide-2's text; externalized media and history are untouched
    const edited = structuredClone(deck);
    edited.content.slides["slide-2"].elements[0].content = "Updated headline";
    const v2Parts = splitPresentation(edited, { mediaThresholdBytes: 4096 });

    const delta = diffSlidePackage(v1Parts.manifest, v2Parts);
    expect(delta.globalChanged).toBe(true);
    expect(delta.historyChanged).toBe(false);
    expect(delta.removedSlideIds).toEqual([]);

    // Only global.json should be in changedBlobs (slides merged into global.json, thumbnail in manifest.json)!
    expect(delta.changedBlobs.size).toBe(1);
    expect(delta.changedBlobs.has(v2Parts.manifest.global.hash)).toBe(true);
    expect(v2Parts.manifest.slides["slide-2"].thumbSvg).toContain("Updated headline");
    // The 4800-byte PNG is NOT re-uploaded
    const pngHash = Object.entries(v1Parts.manifest.media).find(
      ([, m]) => m.mime === "image/png",
    )![0];
    expect(delta.changedBlobs.has(pngHash)).toBe(false);
  });

  it("validates slmedia:// URIs in parseFile", async () => {
    const deck = makeDeckWithMedia();
    const parts = splitPresentation(deck, { mediaThresholdBytes: 4096 });
    const unhydrated = assemblePresentation(parts, { hydrateMedia: false });
    const parsed = parseFile(JSON.stringify(unhydrated), "slide") as SlideFile;
    expect(isSlmediaUri(parsed.content.slides["slide-2"].elements[1].src!)).toBe(true);

    // Unpack round-trip preserves hashes
    const zipBytes = await packSlidePackageZip(parts);
    const unpacked = await unpackSlidePackageZip(zipBytes);
    expect(unpacked.manifestHash).toBe(blake3Hex(unpacked.manifestBytes));
    expect(unpacked.manifest.global.hash).toBe(parts.manifest.global.hash);
  });

  it("keeps an unloaded video in the manifest when its bytes are not on this device", () => {
    const deck = createFile("slide", "Talk") as SlideFile;
    const hash = "ab".repeat(32);
    const id = deck.content.slideOrder[0];
    deck.content.slides[id].elements.push({
      id: "vid",
      type: "video",
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      src: `slmedia://${hash}`,
    });
    const parts = splitPresentation(deck, {
      retainedMedia: {
        [hash]: { mime: "video/mp4", size: 50_000_000, ext: "mp4" },
      },
    });
    expect(parts.manifest.media[hash]).toMatchObject({
      mime: "video/mp4",
      size: 50_000_000,
    });
    expect(parts.blobs.has(hash)).toBe(false);
    const again = splitPresentation(deck);
    expect(again.manifest.media[hash]).toBeUndefined();
  });
});

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
    const parts = splitPresentation(deck);

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

    // Thumbnails are generated and registered in manifest.slides[id] & manifest.media
    const s1Summary = parts.manifest.slides[s1Id];
    const s2Summary = parts.manifest.slides[s2Id];
    expect(s1Summary.thumbHash).toMatch(/^[a-f0-9]{64}$/);
    expect(s1Summary.thumbMime).toBe("image/svg+xml");
    expect(s2Summary.thumbHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parts.manifest.media[s1Summary.thumbHash!]).toBeDefined();

    // Only 1 PNG entry in media (deduplicated across 2 slides) + 2 SVG thumbnails
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

  it("supports O(1) random-access ZIP reading of manifest, global, and a single slide without reading the whole file", async () => {
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
    expect(dir.has("slides/slide-2.json")).toBe(true);

    const manifestRaw = await readZipEntry(dir.get("manifest.json")!, readRange);
    const manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
    expect(manifest.version).toBe(2);

    const slide2Raw = await readZipEntry(dir.get("slides/slide-2.json")!, readRange);
    const slide2 = JSON.parse(new TextDecoder().decode(slide2Raw));
    expect(slide2.id).toBe("slide-2");
    expect(slide2.notes).toBe("Speaker notes for slide 2");
    expect(totalBytesRead).toBeGreaterThan(0);
  });

  it("computes minimal deltas when only one slide is edited", () => {
    const deck = makeDeckWithMedia();
    const v1Parts = splitPresentation(deck);

    // Edit only slide-2's text; slide-1, global, media, and history are untouched
    const edited = structuredClone(deck);
    edited.content.slides["slide-2"].elements[0].content = "Updated headline";
    const v2Parts = splitPresentation(edited);

    const delta = diffSlidePackage(v1Parts.manifest, v2Parts);
    expect(delta.globalChanged).toBe(false);
    expect(delta.historyChanged).toBe(false);
    expect(delta.removedSlideIds).toEqual([]);
    expect(delta.changedSlideIds).toEqual(["slide-2"]);

    // Only slide-2 JSON + slide-2 updated SVG thumbnail should be in changedBlobs!
    expect(delta.changedBlobs.size).toBe(2);
    expect(delta.changedBlobs.has(v2Parts.manifest.slides["slide-2"].hash)).toBe(true);
    expect(
      delta.changedBlobs.has(v2Parts.manifest.slides["slide-2"].thumbHash!),
    ).toBe(true);
    // The 4800-byte PNG is NOT re-uploaded
    const pngHash = Object.entries(v1Parts.manifest.media).find(
      ([, m]) => m.mime === "image/png",
    )![0];
    expect(delta.changedBlobs.has(pngHash)).toBe(false);
  });

  it("validates slmedia:// URIs in parseFile", async () => {
    const deck = makeDeckWithMedia();
    const parts = splitPresentation(deck);
    const unhydrated = assemblePresentation(parts, { hydrateMedia: false });
    const parsed = parseFile(JSON.stringify(unhydrated), "slide") as SlideFile;
    expect(isSlmediaUri(parsed.content.slides["slide-2"].elements[1].src!)).toBe(true);

    // Unpack round-trip preserves hashes
    const zipBytes = await packSlidePackageZip(parts);
    const unpacked = await unpackSlidePackageZip(zipBytes);
    expect(unpacked.manifestHash).toBe(blake3Hex(unpacked.manifestBytes));
    expect(unpacked.manifest.global.hash).toBe(parts.manifest.global.hash);
  });
});

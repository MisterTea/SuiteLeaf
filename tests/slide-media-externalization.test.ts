import { describe, expect, it, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import {
  blake3Hex,
  collectSlmediaHashes,
  createFile,
  isSlmediaUri,
  parsePowerPoint,
  slmediaUri,
  splitPresentation,
  type ExternalMediaBlobs,
  type SlideFile,
} from "../packages/core/src";
import { uint8ToBase64 } from "../packages/core/src/pptx-media";
import { syncSlideDelta } from "../apps/web/src/workspace/slide-delta-sync";
import { MediaBlobStore, mediaBlobStore } from "../apps/web/src/media-blob-store";

async function pptxWithVideo(videoBytes: Uint8Array, ext = "mp4"): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="${ext}" ContentType="video/mp4"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
</p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:pic>
      <p:nvPicPr>
        <p:cNvPr id="2" name="LectureClip"/>
        <p:cNvPicPr/>
        <p:nvPr><a:videoFile r:link="rId1"/></p:nvPr>
      </p:nvPicPr>
      <p:blipFill><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2571750"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:pic>
  </p:spTree></p:cSld>
</p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/clip.${ext}"/>
</Relationships>`,
  );
  zip.file(`ppt/media/clip.${ext}`, videoBytes);
  return zip.generateAsync({ type: "uint8array" });
}

describe("externalized slide media and chunked blob upload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("externalizes PPTX video into slmedia:// binary blobs without base64 encoding", async () => {
    const clip = new Uint8Array(50_000);
    for (let i = 0; i < clip.length; i++) clip[i] = i % 251;
    const pptx = await pptxWithVideo(clip);

    const mediaBlobs: ExternalMediaBlobs = new Map();
    const deck = await parsePowerPoint(pptx, "RL Lecture", undefined, mediaBlobs);

    const slide = deck.content.slides[deck.content.slideOrder[0]];
    const videoEl = slide.elements.find((e) => e.type === "video");
    expect(videoEl).toBeDefined();
    expect(isSlmediaUri(videoEl!.src!)).toBe(true);

    const expectedHash = blake3Hex(clip);
    expect(videoEl!.src).toBe(slmediaUri(expectedHash));
    expect(mediaBlobs.get(expectedHash)?.mime).toBe("video/mp4");
    expect(mediaBlobs.get(expectedHash)?.bytes).toEqual(clip);

    // splitPresentation picks up the binary blob directly from externalBlobs
    const parts = splitPresentation(deck, { externalBlobs: mediaBlobs });
    expect(parts.manifest.media[expectedHash]).toEqual({
      mime: "video/mp4",
      size: clip.byteLength,
      ext: "mp4",
    });
    expect(parts.blobs.get(expectedHash)).toEqual(clip);
  });

  it("uploads large media blobs in bounded Content-Range chunks with progress", async () => {
    const deck = createFile("slide", "Chunked Video") as SlideFile;
    const slideId = deck.content.slideOrder[0];
    const clip = new Uint8Array(3500);
    for (let i = 0; i < clip.length; i++) clip[i] = (i * 7) % 256;
    const hash = blake3Hex(clip);
    await mediaBlobStore.put(hash, "video/mp4", clip);
    deck.content.slides[slideId].elements.push({
      id: "vid-1",
      type: "video",
      x: 0,
      y: 0,
      width: 400,
      height: 225,
      src: slmediaUri(hash),
    });

    const receivedRanges: string[] = [];
    const reassembled = new Map<string, Uint8Array>();

    const mockApi = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/sections/missing")) {
        const body = JSON.parse(String(init?.body)) as { hashes: string[] };
        return new Response(JSON.stringify({ missing: body.hashes }), { status: 200 });
      }
      if (path.includes("/blobs/")) {
        const blobHash = path.split("/blobs/")[1];
        const headers = new Headers(init?.headers);
        const range = headers.get("content-range");
        const chunk = init?.body as Uint8Array;
        if (range) {
          receivedRanges.push(range);
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!;
          const start = Number(match[1]);
          const end = Number(match[2]);
          const total = Number(match[3]);
          let buf = reassembled.get(blobHash);
          if (!buf) {
            buf = new Uint8Array(total);
            reassembled.set(blobHash, buf);
          }
          buf.set(chunk, start);
          if (end + 1 < total) {
            return new Response(JSON.stringify({ accepted: end + 1 }), { status: 202 });
          }
          return new Response(null, { status: 204 });
        }
        reassembled.set(blobHash, chunk);
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/sections/commit")) {
        return new Response(
          JSON.stringify({
            id: "item-1",
            name: "Chunked Video.slslides",
            kind: "file",
            headVersionId: "v1",
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const progressEvents: [number, number][] = [];
    const result = await syncSlideDelta(
      deck,
      { nodeUrl: "https://node.test", itemId: "item-1", name: "Chunked Video.slslides" },
      {
        apiFetch: mockApi,
        blobChunkBytes: 1024,
        onProgress: (accepted, total) => progressEvents.push([accepted, total]),
      },
    );

    expect(result.link.versionId).toBe("v1");
    // 3500 bytes at 1024-byte chunks => 4 Content-Range chunks for the video blob
    expect(receivedRanges).toContain("bytes 0-1023/3500");
    expect(receivedRanges).toContain("bytes 1024-2047/3500");
    expect(receivedRanges).toContain("bytes 2048-3071/3500");
    expect(receivedRanges).toContain("bytes 3072-3499/3500");
    expect(reassembled.get(hash)).toEqual(clip);
    expect(progressEvents.length).toBeGreaterThan(2);
    expect(progressEvents.at(-1)![0]).toBe(progressEvents.at(-1)![1]);
  });

  it("prefetchDeck downloads every slide's slmedia:// blobs for offline presentation mode", async () => {
    const store = new MediaBlobStore();
    const deck = createFile("slide", "Offline Talk") as SlideFile;
    const s1 = deck.content.slideOrder[0];
    const s2 = "slide-2";
    const clip1 = new Uint8Array([1, 2, 3, 4]);
    const clip2 = new Uint8Array([5, 6, 7, 8]);
    const h1 = blake3Hex(clip1);
    const h2 = blake3Hex(clip2);

    deck.content.slides[s1].elements.push({
      id: "v1",
      type: "video",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      src: slmediaUri(h1),
    });
    deck.content.slideOrder.push(s2);
    deck.content.slides[s2] = {
      id: s2,
      layout: "blank",
      elements: [
        {
          id: "v2",
          type: "video",
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          src: slmediaUri(h2),
        },
      ],
      notes: "",
    };

    expect(collectSlmediaHashes(deck.content)).toEqual([h1, h2]);

    // Pre-cache clip1 in memory; clip2 must be fetched from SuiteDrive
    await store.put(h1, "video/mp4", clip1);

    const fetched: string[] = [];
    const mockApi = vi.fn(async (path: string) => {
      fetched.push(path);
      return new Response(clip2, {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    });

    const summary = await store.prefetchDeck(deck, {
      itemId: "item-42",
      apiFetch: mockApi,
    });

    expect(summary).toEqual({ total: 2, cached: 1, downloaded: 1, failed: 0 });
    expect(fetched).toEqual([`/api/drive/items/item-42/blobs/${h2}`]);
    expect(store.getMemory(h2)?.bytes).toEqual(clip2);
  });

  it("aborts syncSlideDelta immediately when signal is cancelled", async () => {
    const deck = createFile("slide", "Cancelled") as SlideFile;
    const controller = new AbortController();
    let calls = 0;
    const mockApi = vi.fn(async (path: string, init?: RequestInit) => {
      calls++;
      if (path.endsWith("/sections/missing")) {
        const body = JSON.parse(String(init?.body)) as { hashes: string[] };
        controller.abort();
        return new Response(JSON.stringify({ missing: body.hashes }), { status: 200 });
      }
      throw new Error("Should not upload blobs after abort");
    });

    await expect(
      syncSlideDelta(
        deck,
        { nodeUrl: "https://node.test", itemId: "item-cancel", name: "Cancelled.slslides" },
        { apiFetch: mockApi, signal: controller.signal },
      ),
    ).rejects.toThrow("Import cancelled");
    expect(calls).toBe(1);
  });

  it("chunked uint8ToBase64 matches Buffer base64 for multi-chunk payloads", () => {
    const big = new Uint8Array(100_000);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    const expected = Buffer.from(big).toString("base64");
    const savedBuffer = globalThis.Buffer;
    try {
      // Simulate browser environment without Buffer
      (globalThis as unknown as { Buffer: unknown }).Buffer = undefined;
      expect(uint8ToBase64(big)).toBe(expected);
    } finally {
      globalThis.Buffer = savedBuffer;
    }
  });
});

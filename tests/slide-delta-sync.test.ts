import { describe, expect, it } from "vitest";
import {
  createFile,
  splitPresentation,
  type DriveLink,
  type Slide,
  type SlideFile,
} from "@suiteleaf/core";
import {
  clearSyncedManifest,
  syncSlideDelta,
} from "../apps/web/src/workspace/slide-delta-sync";
import { SlideStreamLoader } from "../apps/web/src/editors/slide-stream-loader";
import { SlideMediaRegistry } from "../apps/web/src/editors/slide-media-registry";

function makePresentation(): SlideFile {
  const deck = createFile("slide", "Roadmap") as SlideFile;
  const rawBytes = new Uint8Array(5000);
  rawBytes.fill(42);
  const imgUri = `data:image/png;base64,${Buffer.from(rawBytes).toString("base64")}`;

  const s1 = deck.content.slideOrder[0];
  deck.content.slides[s1].title = "Cover";
  deck.content.slides[s1].elements.push({
    id: "cover-img",
    type: "image",
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    src: imgUri,
  });

  for (let i = 2; i <= 4; i++) {
    const id = `slide-${i}`;
    deck.content.slideOrder.push(id);
    deck.content.slides[id] = {
      id,
      title: `Slide ${i}`,
      layout: "title-body",
      elements: [
        {
          id: `txt-${i}`,
          type: "text",
          x: 40,
          y: 40,
          width: 400,
          height: 60,
          content: `Body for slide ${i}`,
        },
      ],
    };
  }
  return deck;
}

describe("web slide delta sync & background streaming", () => {
  it("uploads only modified slide blobs on incremental edits", async () => {
    const itemId = "item-delta-1";
    clearSyncedManifest(itemId);
    const serverBlobs = new Map<string, Uint8Array>();
    let headVersion = "v1";
    const uploadedHashes: string[] = [];

    const mockApi = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path.endsWith("/sections/missing")) {
        const { hashes } = JSON.parse(String(init?.body)) as { hashes: string[] };
        const missing = hashes.filter((h) => !serverBlobs.has(h));
        return new Response(JSON.stringify({ missing }), { status: 200 });
      }
      if (path.includes("/blobs/") && init?.method === "PUT") {
        const hash = path.split("/blobs/")[1];
        const body = init.body as Uint8Array;
        serverBlobs.set(hash, new Uint8Array(body));
        uploadedHashes.push(hash);
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/sections/commit")) {
        const ifMatch = (init?.headers as Record<string, string>)?.["if-match"];
        if (ifMatch && ifMatch !== `"${headVersion}"`) {
          return new Response(
            JSON.stringify({ item: { id: itemId, name: "Roadmap.slslides", headVersionId: headVersion } }),
            { status: 409 },
          );
        }
        headVersion = headVersion === "v1" ? "v2" : "v3";
        return new Response(
          JSON.stringify({ id: itemId, name: "Roadmap.slslides", headVersionId: headVersion }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    };

    const deck = makePresentation();
    const link: DriveLink = {
      nodeUrl: "http://localhost",
      itemId,
      versionId: "v1",
      name: "Roadmap.slslides",
    };

    // Initial sync uploads global + 4 slides + 4 thumbnails + 1 PNG = 10 blobs
    const first = await syncSlideDelta(deck, link, { apiFetch: mockApi });
    expect(first.link.versionId).toBe("v2");
    expect(first.uploadedBlobs).toBe(10);

    // Edit ONLY slide-3
    uploadedHashes.length = 0;
    const edited = structuredClone(deck);
    edited.updatedAt = new Date(Date.now() + 1000).toISOString();
    edited.content.slides["slide-3"].elements[0].content = "Updated slide 3";

    const second = await syncSlideDelta(edited, first.link, { apiFetch: mockApi });
    expect(second.link.versionId).toBe("v3");
    // Only slide-3 JSON + slide-3 updated SVG thumbnail are uploaded (NOT global, s1, s2, s4, or the 5KB PNG!)
    expect(second.uploadedBlobs).toBe(2);
    expect(uploadedHashes).toHaveLength(2);
  });

  it("bootstraps slide 1 immediately and streams remaining slides via NDJSON", async () => {
    const deck = makePresentation();
    const parts = splitPresentation(deck);
    const firstId = deck.content.slideOrder[0];

    const mockApi = async (path: string): Promise<Response> => {
      if (path.includes("/sections/bootstrap")) {
        return new Response(
          JSON.stringify({
            sectioned: true,
            versionId: "v2",
            manifest: parts.manifest,
            global: parts.global,
            slides: { [firstId]: parts.slides[firstId] },
          }),
          { status: 200 },
        );
      }
      if (path.includes("/sections/stream")) {
        const lines = deck.content.slideOrder
          .slice(1)
          .map((id) =>
            JSON.stringify({
              id,
              hash: parts.manifest.slides[id].hash,
              data: parts.slides[id],
            }),
          )
          .join("\n") + "\n";
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(lines));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        });
      }
      throw new Error(`Unexpected path: ${path}`);
    };

    const loader = new SlideStreamLoader(mockApi);
    const boot = await loader.bootstrap("item-1", firstId);
    expect(boot.sectioned).toBe(true);
    if (!boot.sectioned) return;
    expect(Object.keys(boot.slides)).toEqual([firstId]);
    expect(boot.manifest.slideOrder).toHaveLength(4);

    const streamed: Record<string, Slide> = {};
    await loader.startBackgroundStream(
      "item-1",
      (batch) => Object.assign(streamed, batch),
      { batchSize: 2 },
    );
    await loader.ensureAllLoaded();
    expect(Object.keys(streamed).sort()).toEqual(["slide-2", "slide-3", "slide-4"]);
  });

  it("deduplicates concurrent media blob fetches in SlideMediaRegistry", async () => {
    let fetchCount = 0;
    const hash = "a".repeat(64);
    const registry = new SlideMediaRegistry(async (h) => {
      fetchCount++;
      expect(h).toBe(hash);
      return new Uint8Array([1, 2, 3, 4]);
    });

    const [u1, u2] = await Promise.all([
      registry.resolve(`slmedia://${hash}`, "image/png"),
      registry.resolve(`slmedia://${hash}`, "image/png"),
    ]);
    expect(fetchCount).toBe(1);
    expect(u1).toBeTruthy();
    expect(u1).toBe(u2);
    expect(registry.peek(`slmedia://${hash}`)).toBe(u1);
    registry.dispose();
    expect(registry.peek(`slmedia://${hash}`)).toBeNull();
  });
});

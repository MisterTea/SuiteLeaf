import { describe, expect, it, vi } from "vitest";
import { createFile, type SlideFile } from "@suiteleaf/core";
import { MediaBlobStore } from "../apps/web/src/media-blob-store";
import { videoSlmediaHashes } from "../apps/web/src/editors/slide-video-gate";

vi.mock("../apps/web/src/storage", () => ({
  library: {
    getMediaBlobRecord: vi.fn(async () => null),
    putMediaBlob: vi.fn(async () => {}),
  },
}));

describe("slide video loading", () => {
  it("lists each deck video once and ignores pictures", () => {
    const deck = createFile("slide", "Talk") as SlideFile;
    const first = deck.content.slideOrder[0];
    const video = "cd".repeat(32);
    const again = "ef".repeat(32);
    deck.content.slides[first].elements.push(
      {
        id: "pic",
        type: "image",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        src: `slmedia://${"ab".repeat(32)}`,
      },
      {
        id: "clip",
        type: "video",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        src: `slmedia://${video}`,
      },
    );
    deck.content.slideOrder.push("s2");
    deck.content.slides.s2 = {
      id: "s2",
      elements: [
        {
          id: "clip-2",
          type: "video",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          src: `slmedia://${video}`,
        },
        {
          id: "clip-3",
          type: "video",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          src: `slmedia://${again}`,
        },
      ],
    };
    expect(videoSlmediaHashes(deck.content)).toEqual([video, again]);
  });

  it("downloads only videos that are not already stored locally", async () => {
    const store = new MediaBlobStore();
    const local = "aa".repeat(32);
    const remote = "bb".repeat(32);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.put(local, "video/mp4", bytes);
    const fetched: string[] = [];
    const progress: number[] = [];
    const result = await store.downloadMissing([local, remote], {
      itemId: "item",
      apiFetch: async (path) => {
        fetched.push(path);
        return new Response(bytes, { status: 200, headers: { "content-type": "video/mp4" } });
      },
      onProgress: (completed) => progress.push(completed),
    });
    expect(result).toEqual({ total: 1, downloaded: 1, failed: [] });
    expect(fetched).toEqual([`/api/drive/items/item/blobs/${remote}`]);
    expect(store.getMemory(remote)?.bytes).toEqual(bytes);
    expect(progress).toEqual([0, 1]);
  });
});

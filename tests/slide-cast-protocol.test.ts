// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import { castFrame, frameAssembler, frameChunks, portableFrame } from "../apps/web/src/editors/slide-cast-protocol";
import { startOfShow } from "../apps/web/src/editors/slide-fade-in";

afterEach(() => vi.unstubAllGlobals());
function frame() {
  const deck = (createFile("slide") as SlideFile).content;
  return castFrame(deck, 0, startOfShow(0), null);
}

it("sends visual data and the selected MARP page, excluding notes, comments, source, and other slides", () => {
  const deck = (createFile("slide") as SlideFile).content;
  const first = deck.slides[deck.slideOrder[0]];
  first.notes = "Private notes";
  first.elements.push({ id: "picture", type: "image", x: 0, y: 0, width: 50, height: 50, src: "photo.png" });
  deck.slides.other = { ...first, id: "other", notes: "Other notes" };
  deck.slideOrder.push("other");
  deck.marpSource = "Private source";
  deck.marpAssets = { "photo.png": "data:image/png;base64,AA==", "unused.png": "Private asset" };
  const page = { width: 960, height: 540, document: "editor source lines", plain: "<p>Public slide</p>" };
  const result = castFrame(deck, 0, startOfShow(0), null, { pages: [page], dispose() {} });
  const json = JSON.stringify(result);
  for (const secret of ["Private notes", "Other notes", "Private source", "Private asset", "editor source lines"]) expect(json).not.toContain(secret);
  expect(Object.keys(result.deck.slides)).toEqual([first.id]);
  expect(result.deck.marpAssets).toEqual({ "photo.png": "data:image/png;base64,AA==" });
  expect(result.page?.document).toBe(page.plain);
  expect(castFrame(deck, 10, startOfShow(10), null).deck.slides).toEqual({});
});

it("round trips Unicode and escaped large content with every message below 64 KiB", () => {
  const original = frame();
  const slide = Object.values(original.deck.slides)[0];
  slide.elements[0].content = '你好🙂"\\\n'.repeat(20_000);
  const chunks = frameChunks(JSON.stringify(original), "transfer");
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) expect(new TextEncoder().encode(JSON.stringify(chunk)).length).toBeLessThan(64 * 1024);
  const onFrame = vi.fn();
  const receive = frameAssembler(onFrame);
  chunks.slice(0, -1).forEach(receive);
  expect(onFrame).not.toHaveBeenCalled();
  receive(chunks.at(-1));
  expect(onFrame).toHaveBeenCalledExactlyOnceWith(original);
});

it("rejects malformed, out-of-order, oversized, and incompatible transfers", () => {
  const onFrame = vi.fn();
  const receive = frameAssembler(onFrame);
  for (const value of [null, 1, {}, { id: "a", part: -1, total: 1, data: "" }, { id: "a", part: 0, total: 1025, data: "" }, { id: "a", part: 0, total: 1, data: "x".repeat(48_001) }]) receive(value);
  receive({ id: "a", part: 1, total: 2, data: "" });
  receive({ id: "a", part: 0, total: 2, data: "" });
  receive({ id: "b", part: 1, total: 2, data: "" });
  receive({ id: "a", part: 1, total: 3, data: "" });
  receive({ id: "a", part: 1, total: 2, data: "invalid base64!" });
  for (const invalid of [{ version: 2 }, { ...frame(), blank: "url(bad)" }, { ...frame(), index: -1 }]) frameChunks(JSON.stringify(invalid), "invalid").forEach(receive);
  expect(onFrame).not.toHaveBeenCalled();
  const valid = frame();
  valid.blank = "#ffffff";
  frameChunks(JSON.stringify(valid), "valid").forEach(receive);
  expect(onFrame).toHaveBeenCalledWith(valid);
  expect(() => frameChunks("x".repeat(37_000_000), "large")).toThrow("too large");
});

it("embeds blob assets once, including URLs inside MARP HTML and CSS", async () => {
  const original = frame();
  const slide = Object.values(original.deck.slides)[0];
  slide.elements[0].src = "blob:https://example.com/picture";
  original.page = { width: 960, height: 540, document: '<img src="blob:https://example.com/picture">', plain: "url('blob:https://example.com/picture')" };
  const fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) }));
  vi.stubGlobal("fetch", fetch);
  const result = await portableFrame(original);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result).not.toContain("blob:");
  expect(JSON.parse(result).page.plain).toContain("data:image/png;base64,");
  fetch.mockResolvedValueOnce({ ok: false, blob: async () => new Blob() });
  await expect(portableFrame(original)).rejects.toThrow("could not be read");
  vi.stubGlobal("FileReader", class { onerror?: () => void; readAsDataURL() { this.onerror?.(); } });
  await expect(portableFrame(original)).rejects.toThrow("could not be read");
  const local = frame();
  expect(await portableFrame(local)).toBe(JSON.stringify(local));
});

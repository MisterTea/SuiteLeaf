import { describe, expect, it, vi } from "vitest";
import { placeSheetImage, readImageFile } from "../apps/web/src/templates/sheet-image";

describe("sheet pictures", () => {
  it("reads supported pictures as data URLs and refuses others", async () => {
    expect(await readImageFile(new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }))).toBe(
      "data:image/png;base64,AQID",
    );
    expect(await readImageFile(new File(["<svg/>"], "logo.svg"))).toBe(
      `data:image/svg+xml;base64,${btoa("<svg/>")}`,
    );
    await expect(readImageFile(new File(["x"], "notes.txt", { type: "text/plain" }))).rejects.toThrow(
      "Use a PNG, JPEG, GIF, WebP, or SVG image.",
    );
    await expect(readImageFile(new File(["x"], "photo"))).rejects.toThrow();
  });

  it("reads a large picture in pieces", async () => {
    const bytes = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 251);
    const url = await readImageFile(new File([bytes], "big.webp", { type: "image/webp" }));
    expect(Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it("places the picture on the sheet and remembers it on the file", async () => {
    const calls: [string, unknown[]][] = [];
    const builder: Record<string, unknown> = {};
    for (const name of [
      "setSource",
      "setColumn",
      "setRow",
      "setColumnOffset",
      "setRowOffset",
      "setWidth",
      "setHeight",
      "setAnchorType",
    ])
      builder[name] = (...args: unknown[]) => {
        calls.push([name, args]);
        return builder;
      };
    builder.buildAsync = async () => ({ built: true });
    const sheet = {
      getSheetId: () => "sheet-1",
      newOverGridImage: () => builder,
      insertImages: vi.fn(),
    };
    const content: { images?: Record<string, unknown>[] } = { images: [{ id: "old" }] };
    await placeSheetImage(sheet, "BASE64", content, "data:image/png;base64,AA==");
    expect(calls).toEqual([
      ["setSource", ["data:image/png;base64,AA==", "BASE64"]],
      ["setColumn", [4]],
      ["setRow", [1]],
      ["setColumnOffset", [8]],
      ["setRowOffset", [4]],
      ["setWidth", [88]],
      ["setHeight", [88]],
      ["setAnchorType", ["0"]],
    ]);
    const image = content.images![1];
    expect(image).toMatchObject({ sheetId: "sheet-1", row: 1, column: 4, width: 88 });
    expect(sheet.insertImages).toHaveBeenCalledWith([{ built: true, drawingId: image.id }]);
    const fresh: { images?: Record<string, unknown>[] } = {};
    await placeSheetImage(sheet, "BASE64", fresh, "x");
    expect(fresh.images).toHaveLength(1);
  });
});

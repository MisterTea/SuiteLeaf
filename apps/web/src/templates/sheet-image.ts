/** Drop a picture onto the open sheet and remember it on the file. */
export async function placeSheetImage(
  sheet: any,
  sourceType: unknown,
  content: { images?: Record<string, unknown>[] },
  src: string,
) {
  const image = {
    id: crypto.randomUUID(),
    sheetId: sheet.getSheetId() as string,
    src,
    row: 1,
    column: 4,
    offsetX: 8,
    offsetY: 4,
    width: 88,
    height: 88,
    anchorType: "0" as const,
  };
  const built = await sheet
    .newOverGridImage()
    .setSource(src, sourceType)
    .setColumn(image.column)
    .setRow(image.row)
    .setColumnOffset(image.offsetX)
    .setRowOffset(image.offsetY)
    .setWidth(image.width)
    .setHeight(image.height)
    .setAnchorType(image.anchorType)
    .buildAsync();
  sheet.insertImages([{ ...built, drawingId: image.id }]);
  content.images = [...(content.images ?? []), image];
}

export async function readImageFile(file: File): Promise<string> {
  const type = file.type || (file.name.endsWith(".svg") ? "image/svg+xml" : "");
  if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/i.test(type))
    throw new Error("Use a PNG, JPEG, GIF, WebP, or SVG image.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

import { importOffice, type OfficeFormat } from "@suiteleaf/core/office";
self.onmessage = async (
  event: MessageEvent<{
    bytes: ArrayBuffer;
    format: OfficeFormat;
    name: string;
  }>,
) => {
  try {
    const result = await importOffice(
      event.data.bytes,
      event.data.format,
      event.data.name,
    );
    self.postMessage({ ok: true, file: result.file });
  } catch (e) {
    self.postMessage({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

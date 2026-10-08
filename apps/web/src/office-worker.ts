import {
  importOffice,
  OfficeImportError,
  type OfficeFormat,
} from "@suiteleaf/core/office";
self.onmessage = async (
  event: MessageEvent<{
    bytes: ArrayBuffer;
    format: OfficeFormat;
    name: string;
    password?: string;
  }>,
) => {
  try {
    const result = await importOffice(
      event.data.bytes,
      event.data.format,
      event.data.name,
      { password: event.data.password },
    );
    self.postMessage({ ok: true, file: result.file });
  } catch (e) {
    self.postMessage({
      ok: false,
      code: e instanceof OfficeImportError ? e.code : "conversion-failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

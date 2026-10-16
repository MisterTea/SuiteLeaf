import { OfficeImportError } from "@suiteleaf/core/office";
import { openOfficeFile } from "@suiteleaf/core/open-office";
self.onmessage = async (
  event: MessageEvent<{
    bytes: ArrayBuffer;
    format: string;
    name: string;
    password?: string;
  }>,
) => {
  try {
    const file = await openOfficeFile(
      event.data.bytes,
      event.data.format,
      event.data.name,
      { password: event.data.password },
    );
    self.postMessage({ ok: true, file });
  } catch (e) {
    self.postMessage({
      ok: false,
      code: e instanceof OfficeImportError ? e.code : "conversion-failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

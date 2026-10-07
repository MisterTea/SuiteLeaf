import type { SuiteFile } from "@suiteleaf/core";
export async function importOfficeFile(file: File): Promise<SuiteFile> {
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./office-worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          "Office import exceeded two minutes. The original file is unchanged.",
        ),
      );
    }, 120000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event) => {
      finish();
      if (event.data.ok) resolve(event.data.file);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      finish();
      reject(
        new Error(
          event.message || "The Office converter could not load this file.",
        ),
      );
    };
    worker.postMessage(
      {
        bytes,
        format: file.name.split(".").pop()!.toLowerCase(),
        name: file.name,
      },
      [bytes],
    );
  });
}

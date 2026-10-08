import type { SuiteFile } from "@suiteleaf/core";
import { requestOfficePassword } from "./office-password";

class ConverterError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
async function convert(file: File, password?: string): Promise<SuiteFile> {
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
      else
        reject(
          new ConverterError(
            event.data.code ?? "conversion-failed",
            event.data.error,
          ),
        );
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
        password,
      },
      [bytes],
    );
  });
}

export async function importOfficeFile(file: File): Promise<SuiteFile> {
  let password: string | undefined;
  for (;;) {
    try {
      return await convert(file, password);
    } catch (error) {
      if (
        !(error instanceof ConverterError) ||
        !["encrypted", "wrong-password"].includes(error.code)
      )
        throw error;
      const supplied = await requestOfficePassword(
        file.name,
        error.code === "wrong-password",
      );
      if (supplied === null) throw new Error("Import cancelled.");
      password = supplied;
    }
  }
}

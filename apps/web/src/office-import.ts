import type { SuiteFile } from "@suiteleaf/core";
import { requestOfficePassword } from "./office-password";

export const IMPORT_CANCELLED = "Import cancelled. The original file is unchanged.";

/** A stopped import keeps the saved file. A loaded file and an error are discarded. */
export function settleOfficeImport(input: {
  saved: SuiteFile | null;
  loaded: SuiteFile | null;
  stopped: boolean;
  error?: string;
}): { file: SuiteFile } | { error: string } {
  if (input.stopped) {
    if (input.saved) return { file: input.saved };
    return { error: IMPORT_CANCELLED };
  }
  if (input.error) return { error: input.error };
  if (input.loaded) return { file: input.loaded };
  return { error: "The Office converter could not load this file." };
}

class ConverterError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
async function convert(
  file: File,
  password: string | undefined,
  control?: { saved?: SuiteFile | null; shouldStop?: () => boolean },
): Promise<SuiteFile> {
  if (control?.shouldStop?.()) {
    const settled = settleOfficeImport({
      saved: control.saved ?? null,
      loaded: null,
      stopped: true,
    });
    if ("file" in settled) return settled.file;
    throw new Error(settled.error);
  }
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./office-worker.ts", import.meta.url), {
      type: "module",
    });
    let done = false;
    const finish = () => {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      clearInterval(watch);
      worker.terminate();
      return true;
    };
    const settle = (loaded: SuiteFile | null, error?: string) => {
      if (!finish()) return;
      const settled = settleOfficeImport({
        saved: control?.saved ?? null,
        loaded,
        stopped: control?.shouldStop?.() ?? false,
        error,
      });
      if ("file" in settled) resolve(settled.file);
      else if (settled.error === IMPORT_CANCELLED) reject(new Error(settled.error));
      else reject(new ConverterError("conversion-failed", settled.error));
    };
    const timer = setTimeout(() => {
      if (!finish()) return;
      reject(
        new Error(
          "Office import exceeded two minutes. The original file is unchanged.",
        ),
      );
    }, 120000);
    const watch = setInterval(() => {
      if (control?.shouldStop?.()) settle(null);
    }, 50);
    worker.onmessage = (event) => {
      if (control?.shouldStop?.()) {
        settle(null);
        return;
      }
      if (event.data.ok) settle(event.data.file);
      else if (finish()) {
        reject(
          new ConverterError(
            event.data.code ?? "conversion-failed",
            event.data.error,
          ),
        );
      }
    };
    worker.onerror = (event) => {
      if (!finish()) return;
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

export async function importOfficeFile(
  file: File,
  control?: { saved?: SuiteFile | null; shouldStop?: () => boolean },
): Promise<SuiteFile> {
  let password: string | undefined;
  for (;;) {
    try {
      return await convert(file, password, control);
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

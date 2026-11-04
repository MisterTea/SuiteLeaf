import { Type } from "@earendil-works/pi-ai";
import type { SuiteFile } from "@suiteleaf/core";
import { currentSnapshot, waitForHost } from "../host";

/** Words that ask for a file, slide or text to go. */
export const REMOVE_INTENT = /\b(remove|delete|trash|get rid of|throw (it |them )?away|bin it|discard)\b/i;

export const safe = <T>(f: () => T) => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

export type Kind = SuiteFile["kind"];
export const KINDS: Record<string, Kind> = {
  document: "doc",
  doc: "doc",
  spreadsheet: "sheet",
  sheet: "sheet",
  presentation: "slide",
  slides: "slide",
  slide: "slide",
  drawing: "drawing",
};
export const NAMES: Record<Kind, string> = {
  doc: "document",
  sheet: "spreadsheet",
  slide: "presentation",
  form: "form",
  drawing: "drawing",
};
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bring part of the file list into view, so the user sees what the agent acts on. */
export async function scrolledTo<T extends Element>(el: T | undefined, block: ScrollLogicalPosition = "center") {
  const r = el?.getBoundingClientRect();
  if (el && r && (r.top < 0 || r.bottom > innerHeight)) {
    el.scrollIntoView({ behavior: "smooth", block });
    let last = NaN;
    for (let i = 0; i < 40; i++) {
      await wait(60);
      const top = el.getBoundingClientRect().top;
      if (top === last) break;
      last = top;
    }
  }
  return el;
}

export const kindParam = Type.String({ enum: ["document", "spreadsheet", "presentation"] });

/** After navigating to an editor, describe it for the model. */
export async function opened(kind: Kind, what: string) {
  await waitForHost(kind);
  return `${what}\n${currentSnapshot()}`;
}

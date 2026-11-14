import type { AudienceFrame } from "./presenter-display";
import { audiencePhase, fadeOnClickIds } from "./slide-fade-in";
import { inheritedText } from "./slide-master";

type AudienceElement = {
  id?: string;
  type?: string;
  content?: string;
  alt?: string;
  decorative?: boolean;
  rows?: string[][];
  placeholder?: string;
  animation?: string;
  animationOrder?: number;
  animationTrigger?: string;
};

type AudienceMaster = { id?: string; placeholder?: string; content?: string };

/** Visible text on the slide, in order. Speaker notes are not on an element. */
export function audienceLines(
  elements: readonly AudienceElement[],
  revealed?: number,
  master: readonly AudienceMaster[] = [],
): string[] {
  const ordered = elements.filter((element): element is AudienceElement & { id: string } => typeof element.id === "string");
  const order = revealed == null ? [] : fadeOnClickIds(ordered);
  const masterText = master.map((item) => ({
    id: item.id ?? "",
    placeholder: item.placeholder,
    content: item.content,
  }));
  const lines: string[] = [];
  for (const element of elements) {
    if (element.decorative) continue;
    if (revealed != null && element.id) {
      const phase = audiencePhase(
        {
          id: element.id,
          animation: element.animation,
          animationOrder: element.animationOrder,
          animationTrigger: element.animationTrigger,
        },
        revealed,
        order,
        null,
      );
      if (phase === "hidden") continue;
    }
    if (element.type === "table" && element.rows) {
      for (const row of element.rows) {
        for (const cell of row) {
          const text = cell.replace(/\s+/g, " ").trim();
          if (text) lines.push(text);
        }
      }
      continue;
    }
    const content =
      element.type === "text" || element.type === "shape"
        ? inheritedText(
            { id: element.id ?? "", placeholder: element.placeholder, content: element.content },
            masterText,
          ).content
        : element.content;
    if ((element.type === "text" || element.type === "shape") && content) {
      for (const line of content.split("\n")) {
        const text = line.replace(/\s+/g, " ").trim();
        if (text) lines.push(text);
      }
      continue;
    }
    const alt = element.alt?.replace(/\s+/g, " ").trim();
    if (alt) lines.push(alt);
  }
  return lines;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

/** The audience document. A blank screen does not include the slide text. */
export function audienceScreenDocument(frame: AudienceFrame, lines: readonly string[]): string {
  const body = frame.blank
    ? "<h1>The screen is blank.</h1>"
    : lines.length
      ? [`<h1>${escapeHtml(lines[0]!)}</h1>`, ...lines.slice(1).map((line) => `<p>${escapeHtml(line)}</p>`)].join("")
      : `<h1>Slide ${frame.slideIndex + 1}</h1>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Audience</title></head><body>${body}</body></html>`;
}

export type AudiencePopup = {
  closed?: boolean;
  location: { replace: (url: string) => void };
} | null;

const audienceUrls = new WeakMap<NonNullable<AudiencePopup>, string>();

/** A standalone document stays out of the app router and survives a popup refresh. */
export function openAudienceScreen(
  popup: AudiencePopup,
  frame: AudienceFrame,
  lines: readonly string[],
  marpDocument?: string,
): boolean {
  if (!popup || popup.closed) return false;
  const previous = audienceUrls.get(popup);
  let next: string | undefined;
  try {
    next = URL.createObjectURL(
      new Blob([!frame.blank && marpDocument ? marpDocument : audienceScreenDocument(frame, lines)], { type: "text/html" }),
    );
    popup.location.replace(next);
    audienceUrls.set(popup, next);
    if (previous) URL.revokeObjectURL(previous);
    return true;
  } catch {
    if (next) URL.revokeObjectURL(next);
    return false;
  }
}

/** Plain text of the visible slides. A hidden slide is left out. The deck passed in is not changed. */

type Piece = {
  type?: string;
  wordArt?: boolean;
  decorative?: boolean;
  content?: string;
  rows?: string[][];
  alt?: string;
};

type Slide = {
  title?: string;
  hidden?: boolean;
  notes?: string;
  elements?: Piece[];
};

export function slidePlainText(title: string, order: readonly string[], slides: Record<string, Slide>): string {
  const visible = order.map((id) => slides[id]).filter((slide) => slide && slide.hidden !== true);
  const lines = [`Title: ${title}`, `Slides: ${visible.length}`, ""];
  visible.forEach((slide, index) => {
    const heading = slide.elements
      ?.find(
        (element) =>
          element.type === "text" && !element.wordArt && !element.decorative && element.content?.trim(),
      )
      ?.content?.trim()
      .split("\n")[0];
    lines.push(`--- Slide ${index + 1}: ${slide.title || heading || "Untitled"} ---`);
    for (const element of slide.elements ?? []) {
      if (element.decorative) continue;
      if (element.type === "text" && element.content) lines.push(element.content);
      if (element.type === "table" && element.rows) {
        lines.push(element.rows.map((row) => row.join("\t")).join("\n"));
      }
      if ((element.type === "audio" || element.type === "video") && element.alt) {
        lines.push(`${element.type === "audio" ? "Audio" : "Video"}: ${element.alt}`);
      }
    }
    if (slide.notes) lines.push(`[Speaker notes: ${slide.notes}]`);
    lines.push("");
  });
  return lines.join("\n");
}

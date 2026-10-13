import { createFile, type SlideElement, type SlideFile } from "@suiteleaf/core";

export const CHART_NOTES = "Point at September — the tall green bar.";
export const NEXT_NOTES = "Invite questions.";
export const CHART_ALT = "Quarterly revenue chart";

export function chartSrc() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420">
    <rect width="800" height="420" rx="18" fill="#f8fafc"/>
    <text x="32" y="48" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#202124">Quarterly revenue</text>
    <rect x="90" y="230" width="80" height="120" rx="8" fill="#1a73e8"/>
    <rect x="250" y="170" width="80" height="180" rx="8" fill="#34a853"/>
    <rect x="410" y="90" width="80" height="260" rx="8" fill="#188038"/>
    <rect x="570" y="190" width="80" height="160" rx="8" fill="#f9ab00"/>
    <text x="130" y="390" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#3c4043">Jul</text>
    <text x="290" y="390" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#3c4043">Aug</text>
    <text x="450" y="390" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#3c4043">Sep</text>
    <text x="610" y="390" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#3c4043">Oct</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function text(content: string, extra: Partial<SlideElement> = {}): SlideElement {
  return {
    id: extra.id ?? crypto.randomUUID(),
    type: "text",
    x: 48,
    y: 18,
    width: 860,
    height: 48,
    content,
    fontSize: 28,
    bold: true,
    color: "#202124",
    ...extra,
  };
}

/** Maria's deck: a chart slide, then a clean next slide. */
export function q3Update(): SlideFile {
  const file = createFile("slide", "Q3 update") as SlideFile;
  const chartId = file.content.slideOrder[0];
  const nextId = "next-steps";
  file.content.slides[chartId] = {
    id: chartId,
    elements: [
      text("Chart", { id: "chart-title" }),
      {
        id: "chart",
        type: "image",
        x: 80,
        y: 78,
        width: 800,
        height: 420,
        src: chartSrc(),
        alt: CHART_ALT,
      },
    ],
    notes: CHART_NOTES,
  };
  file.content.slides[nextId] = {
    id: nextId,
    elements: [
      text("Next steps", { id: "next-title" }),
      text("Send the deck before the meeting.", {
        id: "next-body",
        y: 140,
        height: 80,
        fontSize: 24,
        bold: false,
        color: "#334155",
      }),
    ],
    notes: NEXT_NOTES,
  };
  file.content.slideOrder = [chartId, nextId];
  return file;
}

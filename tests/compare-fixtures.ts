import { parseFile, type SheetFile, type SlideFile } from "@suiteleaf/core";

export const ROSTER_NAMES = ["Rosa", "Sam", "Priya", "Leo", "Ana", "Jordan", "Noah"];
export const ROSTER_EARLIER = ["Invited", "Invited", "Invited", "Invited", "Invited", "Invited", "Confirmed"];
export const ROSTER_YESTERDAY = ["Maybe", "Maybe", "Yes", "Maybe", "No", "Maybe", "Confirmed"];
export const ROSTER_MORNING = ["Confirmed", "Confirmed", "Waitlist", "Confirmed", "Declined", "Confirmed", "Confirmed"];

export function rosterFile(
  id: string,
  when: string,
  statuses: string[],
  bold: boolean,
): SheetFile {
  const sheetId = `${id}-roster`;
  const header = (text: string) =>
    bold ? { v: text, t: 1, s: { bl: 1 } } : { v: text, t: 1 };
  const cellData: Record<string, Record<string, unknown>> = {
    0: { 0: header("Name"), 1: header("Status") },
  };
  ROSTER_NAMES.forEach((name, index) => {
    cellData[String(index + 1)] = {
      0: { v: name, t: 1 },
      1: { v: statuses[index], t: 1 },
    };
  });
  return parseFile(
    JSON.stringify({
      format: "suiteleaf",
      version: 1,
      id,
      title: "Volunteer roster",
      createdAt: when,
      updatedAt: when,
      kind: "sheet",
      content: {
        workbook: {
          id,
          name: "Volunteer roster",
          sheetOrder: [sheetId],
          sheets: {
            [sheetId]: {
              id: sheetId,
              name: "Roster",
              rowCount: 100,
              columnCount: 8,
              cellData,
            },
          },
        },
        charts: [],
        pivots: [],
      },
    }),
  ) as SheetFile;
}

function text(
  id: string,
  content: string,
  y: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    type: "text",
    x: 80,
    y,
    width: 800,
    height: extra.height ?? 80,
    content,
    fontSize: extra.fontSize ?? 28,
    align: extra.align ?? "center",
    color: extra.color ?? "#1e293b",
    bold: extra.bold ?? false,
  };
}

export function deckFile(
  id: string,
  when: string,
  title: string,
  thankYou: boolean,
): SlideFile {
  const slides: Record<string, unknown> = {
    "slide-title": {
      id: "slide-title",
      title,
      layout: "title",
      background: { color: "#e7f5ee" },
      elements: [
        text("el-title", title, 150, { height: 150, fontSize: 44, bold: true }),
        text("el-sub", "Community hall · Saturday", 330, { fontSize: 22, color: "#475569" }),
      ],
      notes: "",
    },
    "slide-plan": {
      id: "slide-plan",
      title: "The plan",
      layout: "title-body",
      background: { color: "#ffffff" },
      elements: [
        text("el-plan-title", "The plan", 48, { fontSize: 36, bold: true, align: "left" }),
        text("el-plan-body", "Meet at the hall, then walk the grounds.", 140, {
          height: 120,
          fontSize: 22,
          align: "left",
        }),
      ],
      notes: "",
    },
  };
  const order = ["slide-title", "slide-plan"];
  if (thankYou) {
    order.push("slide-thanks");
    slides["slide-thanks"] = {
      id: "slide-thanks",
      title: "Thank you",
      layout: "section",
      background: { color: "#1e293b" },
      elements: [
        text("el-thanks", "Thank you", 180, { height: 100, fontSize: 54, bold: true, color: "#f8fafc" }),
        text("el-thanks-sub", "See you on Saturday", 300, { fontSize: 22, color: "#cbd5e1" }),
      ],
      notes: "",
    };
  }
  return parseFile(
    JSON.stringify({
      format: "suiteleaf",
      version: 1,
      id,
      title: "Fundraiser pitch",
      createdAt: when,
      updatedAt: when,
      kind: "slide",
      content: {
        id,
        width: 960,
        height: 540,
        slideOrder: order,
        slides,
      },
    }),
  ) as SlideFile;
}

import {
  createFile,
  type DocFile,
  type JsonNode,
  type SheetFile,
  type SlideFile,
  type SuiteFile,
} from "@suiteleaf/core";

export interface BuiltinTemplate {
  id: string;
  name: string;
  kind: SuiteFile["kind"];
  description: string;
  create: () => SuiteFile;
}

type Style = {
  bl?: number;
  fs?: number;
  ht?: number;
  bg?: { rgb: string };
  n?: { pattern: string };
};
type CellInput =
  | string
  | number
  | { f: string; s?: Style }
  | { v: string | number; s?: Style };

const head: Style = { bl: 1, bg: { rgb: "#e6f4ea" } };
const title: Style = { bl: 1, fs: 18, bg: { rgb: "#e6f4ea" } };
const money: Style = { n: { pattern: '"$"#,##0.00' }, ht: 3 };
const moneyBold: Style = { ...money, bl: 1 };
const percent: Style = { n: { pattern: "0%" }, ht: 3, bl: 1 };

function text(value: string, marks?: JsonNode["marks"]): JsonNode {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}
function paragraph(value: string, marks?: JsonNode["marks"]): JsonNode {
  return value
    ? { type: "paragraph", content: [text(value, marks)] }
    : { type: "paragraph" };
}
function heading(level: number, value: string): JsonNode {
  return { type: "heading", attrs: { level }, content: [text(value)] };
}
function bullets(items: string[]): JsonNode {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraph(item)],
    })),
  };
}
function document(name: string, blocks: JsonNode[]): DocFile {
  const file = createFile("doc", name) as DocFile;
  file.content = { type: "doc", content: blocks };
  return file;
}
function workbook(
  name: string,
  rows: CellInput[][],
  widths: number[],
  sheetName: string,
): SheetFile {
  const file = createFile("sheet", name) as SheetFile;
  const id = file.content.workbook.sheetOrder[0];
  const sheet = file.content.workbook.sheets[id];
  sheet.name = sheetName;
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(
        row.flatMap((input, c) => {
          const cell =
            input === ""
              ? null
              : typeof input === "number"
                ? { v: input, t: 2 }
                : typeof input === "string"
                  ? { v: input, t: 1 }
                  : "f" in input
                    ? { f: input.f, s: input.s }
                    : {
                        v: input.v,
                        t: typeof input.v === "number" ? 2 : 1,
                        s: input.s,
                      };
          return cell ? [[c, cell] as const] : [];
        }),
      ),
    ]),
  );
  sheet.columnData = Object.fromEntries(widths.map((w, i) => [i, { w }]));
  return file;
}

function element(
  slideId: string,
  partial: Omit<SlideFile["content"]["slides"][string]["elements"][number], "id">,
) {
  return { id: `${slideId}-${partial.type}-${partial.x}-${partial.y}`, ...partial };
}

function deck(
  name: string,
  slides: {
    title: string;
    background: string;
    notes: string;
    elements: Omit<SlideFile["content"]["slides"][string]["elements"][number], "id">[];
  }[],
): SlideFile {
  const file = createFile("slide", name) as SlideFile;
  const first = file.content.slideOrder[0];
  const ids = slides.map((_, i) => (i === 0 ? first : crypto.randomUUID()));
  file.content.slideOrder = ids;
  file.content.slides = Object.fromEntries(
    slides.map((slide, i) => [
      ids[i],
      {
        id: ids[i],
        title: slide.title,
        layout: i === 0 ? "title" : "title-body",
        background: { color: slide.background },
        notes: slide.notes,
        elements: slide.elements.map((el) => element(ids[i], el)),
      },
    ]),
  );
  return file;
}

const line = (row: number) => ({
  f: `=IF(B${row}*C${row}=0,"",B${row}*C${row})`,
  s: money,
});

export const builtins: BuiltinTemplate[] = [
  {
    id: "invoice",
    name: "Invoice",
    kind: "sheet",
    description: "Quantities and prices. The amount calculates itself.",
    create: () =>
      workbook(
        "Invoice",
        [
          [{ v: "INVOICE", s: title }],
          ["From", ""],
          ["Bill to", ""],
          [],
          [
            { v: "Item", s: head },
            { v: "Qty", s: head },
            { v: "Price", s: head },
            { v: "Amount", s: head },
          ],
          ["", "", "", line(6)],
          ["", "", "", line(7)],
          ["", "", "", line(8)],
          ["", "", { v: "Total", s: { bl: 1 } }, { f: "=SUM(D6:D8)", s: moneyBold }],
        ],
        [220, 80, 110, 130],
        "Invoice",
      ),
  },
  {
    id: "meeting-notes",
    name: "Meeting notes",
    kind: "doc",
    description: "Agenda, decisions, and what happens next.",
    create: () =>
      document("Meeting notes", [
        heading(1, "Meeting notes"),
        paragraph("Date · Who's here"),
        heading(2, "Agenda"),
        bullets(["First topic", "Second topic", "Time left for questions"]),
        heading(2, "Decisions"),
        bullets(["What you agreed"]),
        heading(2, "Next steps"),
        bullets(["Who does what, and by when"]),
      ]),
  },
  {
    id: "budget",
    name: "Budget",
    kind: "sheet",
    description: "What you planned, what you spent, and what's left.",
    create: () =>
      workbook(
        "Budget",
        [
          [{ v: "Budget", s: title }],
          [],
          [
            { v: "Category", s: head },
            { v: "Planned", s: head },
            { v: "Actual", s: head },
            { v: "Left", s: head },
          ],
          ["Rent", { v: 1400, s: money }, { v: 1400, s: money }, { f: "=B4-C4", s: money }],
          ["Ingredients", { v: 600, s: money }, { v: 480, s: money }, { f: "=B5-C5", s: money }],
          ["Market fees", { v: 80, s: money }, { v: 80, s: money }, { f: "=B6-C6", s: money }],
          ["Packaging", { v: 120, s: money }, { v: 95, s: money }, { f: "=B7-C7", s: money }],
          [
            { v: "Total", s: { bl: 1 } },
            { f: "=SUM(B4:B7)", s: moneyBold },
            { f: "=SUM(C4:C7)", s: moneyBold },
            { f: "=SUM(D4:D7)", s: moneyBold },
          ],
        ],
        [180, 120, 120, 120],
        "Budget",
      ),
  },
  {
    id: "project-tracker",
    name: "Project tracker",
    kind: "sheet",
    description: "Tasks, owners, and how much is finished.",
    create: () =>
      workbook(
        "Project tracker",
        [
          [{ v: "Project tracker", s: title }],
          [],
          [
            { v: "Task", s: head },
            { v: "Owner", s: head },
            { v: "Done", s: head },
          ],
          ["Write the menu", "Tomás", { v: 1, s: { ht: 3 } }],
          ["Confirm the stall", "Tomás", { v: 0, s: { ht: 3 } }],
          ["Print price cards", "Ana", { v: 1, s: { ht: 3 } }],
          [
            { v: "Finished", s: { bl: 1 } },
            "",
            { f: "=SUM(C4:C6)/3", s: percent },
          ],
        ],
        [220, 140, 100],
        "Tracker",
      ),
  },
  {
    id: "pitch-deck",
    name: "Pitch deck",
    kind: "slide",
    description: "A title, the idea, and the ask.",
    create: () =>
      deck("Pitch deck", [
        {
          title: "Your pitch",
          background: "#f8fafc",
          notes: "Say who you are and what you want in one sentence.",
          elements: [
            {
              type: "text",
              x: 80,
              y: 170,
              width: 800,
              height: 90,
              content: "Your pitch",
              fontSize: 54,
              bold: true,
              align: "center",
              color: "#0f172a",
            },
            {
              type: "text",
              x: 140,
              y: 280,
              width: 680,
              height: 50,
              content: "One idea, clearly told.",
              fontSize: 22,
              align: "center",
              color: "#475569",
            },
          ],
        },
        {
          title: "The idea",
          background: "#ffffff",
          notes: "The problem, then what you do about it.",
          elements: [
            {
              type: "text",
              x: 70,
              y: 48,
              width: 820,
              height: 64,
              content: "The idea",
              fontSize: 36,
              bold: true,
              color: "#0f172a",
            },
            {
              type: "shape",
              x: 70,
              y: 150,
              width: 380,
              height: 280,
              shapeType: "roundRect",
              fill: "#e6f4ea",
            },
            {
              type: "text",
              x: 96,
              y: 180,
              width: 330,
              height: 200,
              content: "Who it's for\n\nWhat they need\n\nHow you help",
              fontSize: 22,
              color: "#14532d",
            },
            {
              type: "shape",
              x: 490,
              y: 150,
              width: 380,
              height: 280,
              shapeType: "roundRect",
              fill: "#e8f0fe",
            },
            {
              type: "text",
              x: 516,
              y: 180,
              width: 330,
              height: 200,
              content: "What you bring\n\nWhy now\n\nWhat it costs",
              fontSize: 22,
              color: "#1e3a8a",
            },
          ],
        },
        {
          title: "The ask",
          background: "#14532d",
          notes: "End with the specific thing you want.",
          elements: [
            {
              type: "text",
              x: 80,
              y: 180,
              width: 800,
              height: 80,
              content: "The ask",
              fontSize: 48,
              bold: true,
              align: "center",
              color: "#f8fafc",
            },
            {
              type: "text",
              x: 140,
              y: 280,
              width: 680,
              height: 70,
              content: "Say exactly what you need.",
              fontSize: 22,
              align: "center",
              color: "#bbf7d0",
            },
          ],
        },
      ]),
  },
  {
    id: "letter",
    name: "Letter",
    kind: "doc",
    description: "A date, a greeting, and a place to sign.",
    create: () =>
      document("Letter", [
        paragraph("Date"),
        paragraph(""),
        paragraph("Their name"),
        paragraph("Their address"),
        paragraph(""),
        paragraph("Dear [name],"),
        paragraph(""),
        paragraph("Write the letter here."),
        paragraph(""),
        paragraph("Sincerely,"),
        paragraph("Your name"),
      ]),
  },
  {
    id: "announcement",
    name: "Announcement",
    kind: "slide",
    description: "A title slide and the details underneath.",
    create: () =>
      deck("Announcement", [
        {
          title: "Announcement",
          background: "#fffbeb",
          notes: "Read the headline, then the one detail that matters.",
          elements: [
            {
              type: "shape",
              x: 70,
              y: 70,
              width: 120,
              height: 12,
              shapeType: "roundRect",
              fill: "#f59e0b",
            },
            {
              type: "text",
              x: 70,
              y: 160,
              width: 820,
              height: 120,
              content: "Announcement",
              fontSize: 52,
              bold: true,
              color: "#78350f",
            },
            {
              type: "text",
              x: 70,
              y: 300,
              width: 760,
              height: 60,
              content: "The news, in one line.",
              fontSize: 24,
              color: "#92400e",
            },
          ],
        },
        {
          title: "Details",
          background: "#ffffff",
          notes: "When, where, and what to do.",
          elements: [
            {
              type: "text",
              x: 70,
              y: 48,
              width: 820,
              height: 64,
              content: "Details",
              fontSize: 36,
              bold: true,
              color: "#0f172a",
            },
            {
              type: "text",
              x: 70,
              y: 160,
              width: 800,
              height: 260,
              content: "When\n\nWhere\n\nWhat to bring",
              fontSize: 28,
              color: "#334155",
            },
          ],
        },
      ]),
  },
];

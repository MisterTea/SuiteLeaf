import {
  createFile,
  type DocFile,
  type SheetFile,
  type SlideFile,
} from "@suiteleaf/core";
export function sampleDoc(): DocFile {
  const f = createFile("doc", "Welcome to SuiteLeaf") as DocFile;
  f.content = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "A little room to think." }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Welcome to SuiteLeaf. Your documents and spreadsheets stay on this device. Start writing, organize an idea, or turn a few numbers into something useful.",
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Make yourself at home" }],
      },
      {
        type: "bulletList",
        content: [
          "Give your document a title.",
          "Try the formatting toolbar or insert a table.",
          "Export a SuiteLeaf file to carry your work between web and desktop.",
        ].map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Built for your work. Open to everyone.",
            marks: [{ type: "italic" }],
          },
        ],
      },
    ],
  };
  return f;
}
export function sampleSheet(): SheetFile {
  const f = createFile("sheet", "Quarterly studio budget") as SheetFile;
  const id = f.content.workbook.sheetOrder[0];
  const rows = [
    ["Category", "Budget", "Actual", "Remaining"],
    ["Design", 6000, 5200, "=B2-C2"],
    ["Engineering", 12000, 10800, "=B3-C3"],
    ["Research", 3000, 2400, "=B4-C4"],
    ["Operations", 2000, 1850, "=B5-C5"],
    ["Total", "=SUM(B2:B5)", "=SUM(C2:C5)", "=SUM(D2:D5)"],
  ];
  f.content.workbook.sheets[id].cellData = Object.fromEntries(
    rows.map((r, i) => [
      i,
      Object.fromEntries(
        r.map((v, j) => [
          j,
          typeof v === "string" && v.startsWith("=")
            ? { f: v }
            : {
                v,
                t: typeof v === "number" ? 2 : 1,
                s: i === 0 ? { bg: { rgb: "#e3f0e9" }, bl: 1 } : undefined,
              },
        ]),
      ),
    ]),
  );
  return f;
}
export function sampleSlide(): SlideFile {
  const f = createFile("slide", "Ideas in the clear") as SlideFile;
  const s1Id = f.content.slideOrder[0];
  const s2Id = crypto.randomUUID();
  const s3Id = crypto.randomUUID();

  f.content.slideOrder = [s1Id, s2Id, s3Id];
  f.content.slides = {
    [s1Id]: {
      id: s1Id,
      title: "Ideas in the clear",
      layout: "title",
      background: { color: "#f8fafc" },
      elements: [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 100,
          y: 150,
          width: 760,
          height: 100,
          content: "Ideas in the clear.",
          fontSize: 48,
          bold: true,
          align: "center",
          color: "#0f172a",
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 120,
          y: 270,
          width: 720,
          height: 60,
          content:
            "A focused, private presentation canvas built for your work.",
          fontSize: 22,
          align: "center",
          color: "#475569",
        },
      ],
      notes: "Welcome everyone and introduce the purpose of today's review.",
    },
    [s2Id]: {
      id: s2Id,
      title: "Core presentation features",
      layout: "title-body",
      background: { color: "#ffffff" },
      elements: [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 80,
          y: 50,
          width: 800,
          height: 60,
          content: "Thoughtful slide design",
          fontSize: 34,
          bold: true,
          align: "left",
          color: "#0f172a",
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 80,
          y: 140,
          width: 520,
          height: 300,
          content:
            "• Organize decks with intuitive thumbnail navigation\n• Format headings, paragraphs, and list emphasis\n• Add shapes, images, and presentation speaker notes\n• Import existing PowerPoint presentations seamlessly\n• Run full-screen slideshows or print handouts to PDF",
          fontSize: 18,
          bullet: true,
          align: "left",
          color: "#334155",
        },
        {
          id: crypto.randomUUID(),
          type: "shape",
          x: 640,
          y: 150,
          width: 240,
          height: 260,
          shapeType: "roundRect",
          fill: "#e0f2fe",
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 660,
          y: 230,
          width: 200,
          height: 100,
          content: "Built for clarity and focus.",
          fontSize: 20,
          bold: true,
          align: "center",
          color: "#0369a1",
        },
      ],
      notes:
        "Highlight the ability to edit offline and import existing PowerPoint decks.",
    },
    [s3Id]: {
      id: s3Id,
      title: "Simplicity at work",
      layout: "title-body",
      background: { color: "#0f172a" },
      elements: [
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 100,
          y: 180,
          width: 760,
          height: 120,
          content:
            "“Simplicity is about subtracting the obvious and adding the meaningful.”",
          fontSize: 30,
          italic: true,
          align: "center",
          color: "#f8fafc",
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 100,
          y: 320,
          width: 760,
          height: 50,
          content: "— John Maeda, The Laws of Simplicity",
          fontSize: 18,
          align: "center",
          color: "#94a3b8",
        },
      ],
      notes: "Wrap up the presentation and invite questions from the audience.",
    },
  };
  return f;
}

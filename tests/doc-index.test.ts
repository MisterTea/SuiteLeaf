import { expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type DocFile } from "../packages/core/src";
import { refreshIndex } from "../packages/core/src/doc-index";
import { defaultPageSettings } from "../packages/core/src/document-layout";
import { exportDocx } from "../packages/core/src/docx-export";

const report = {
  type: "doc",
  content: [
    { type: "index", content: [] },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Beds are north",
          marks: [{ type: "index", attrs: { term: "Tomato" } }],
        },
      ],
    },
    { type: "sectionBreak" },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "The paths are ready",
          marks: [{ type: "index", attrs: { term: "Paths" } }],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "tomato again",
          marks: [{ type: "index", attrs: { term: "tomato" } }],
        },
      ],
    },
  ],
};

it("rebuilds an index from marked terms and leaves the sentences out", async () => {
  const refreshed = refreshIndex(report);
  const lines = refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(lines).toEqual(["Paths, section 2", "Tomato, section 1"]);
  expect(report.content[0].content).toEqual([]);
  expect(JSON.stringify(refreshed)).toContain("Beds are north");
  expect(lines?.join(" ")).not.toContain("ready");
  expect(lines?.join(" ")).not.toContain("north");

  const withoutTomato = {
    ...report,
    content: report.content.map((node) => ({
      ...node,
      content: node.content?.map((child) =>
        child.type === "text"
          ? {
              ...child,
              marks: child.marks?.filter(
                (mark) => String(mark.attrs?.term ?? "").toLocaleLowerCase("en") !== "tomato",
              ),
            }
          : child,
      ),
    })),
  };
  const again = refreshIndex(withoutTomato);
  expect(again.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Paths, section 2",
  ]);

  const file = createFile("doc", "Report") as DocFile;
  file.content = refreshed as DocFile["content"];
  const xml = await (await JSZip.loadAsync(await exportDocx(file))).file("word/document.xml")!.async("string");
  expect(xml).toContain("Tomato, section 1");
  expect(xml).toContain("Paths, section 2");
  expect(xml.indexOf("Paths, section 2")).toBeLessThan(xml.indexOf("Tomato, section 1"));
});

it("numbers index entries with the printed page, starting where the file starts", async () => {
  const numbered = {
    type: "doc",
    content: [
      { type: "index", content: [] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Beds are north",
            marks: [{ type: "index", attrs: { term: "Tomato" } }],
          },
        ],
      },
      { type: "pageBreak" },
      { type: "note", content: [{ type: "pageBreak" }] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The paths are ready",
            marks: [{ type: "index", attrs: { term: "Paths" } }],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "secret-value" }] },
    ],
  };
  const settings = { ...defaultPageSettings, pageNumbers: true, pageNumberStart: 5 };
  const refreshed = refreshIndex(numbered, settings);
  const lines = refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(lines).toEqual(["Paths, 6", "Tomato, 5"]);
  expect(lines?.join(" ")).not.toContain("secret-value");
  expect(lines?.join(" ")).not.toContain("section");
  expect(numbered.content[0].content).toEqual([]);
  const file = createFile("doc", "Report") as DocFile;
  file.content = { ...refreshed, attrs: { pageSettings: settings } } as DocFile["content"];
  const xml = await (await JSZip.loadAsync(await exportDocx(file))).file("word/document.xml")!.async("string");
  expect(xml).toContain("Tomato, 5");
  expect(xml).toContain("Paths, 6");
});

it("writes a roman page number when the file uses roman numerals", async () => {
  const numbered = {
    type: "doc",
    content: [
      { type: "index", content: [] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Beds are north",
            marks: [{ type: "index", attrs: { term: "Tomato" } }],
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "The paths are ready",
            marks: [{ type: "index", attrs: { term: "Paths" } }],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "secret-value" }] },
    ],
  };
  const settings = {
    ...defaultPageSettings,
    pageNumbers: true,
    pageNumberStart: 5,
    pageNumberFormat: "roman" as const,
  };
  const refreshed = refreshIndex(numbered, settings);
  const lines = refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(lines).toEqual(["Paths, vi", "Tomato, v"]);
  expect(lines?.join(" ")).not.toContain("secret-value");
  expect(lines?.join(" ")).not.toContain("5");
  const file = createFile("doc", "Report") as DocFile;
  file.content = { ...refreshed, attrs: { pageSettings: settings } } as DocFile["content"];
  const xml = await (await JSZip.loadAsync(await exportDocx(file))).file("word/document.xml")!.async("string");
  expect(xml).toContain("Tomato, v");
  expect(xml).toContain("Paths, vi");
  const paged = refreshIndex(numbered, { ...settings, pageNumberFormat: "page" });
  expect(paged.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Paths, Page 6",
    "Tomato, Page 5",
  ]);
});

it("lists a marked subentry under its term and leaves the sentence out", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] as { content?: { text?: string }[] }[] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "secret-value",
            marks: [{ type: "index", attrs: { term: "Tomato", subentry: "North" } }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Beds",
            marks: [{ type: "index", attrs: { term: "Tomato" } }],
          },
        ],
      },
    ],
  };
  const refreshed = refreshIndex(doc);
  expect(refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Tomato, section 1",
    "Tomato, North, section 1",
  ]);
  expect(JSON.stringify(refreshed.content?.[0])).not.toContain("secret-value");
  expect(doc.content[0].content).toEqual([]);
});

it("points a term at another term and leaves the sentence out", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] as { content?: { text?: string }[] }[] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "secret-value",
            marks: [{ type: "index", attrs: { term: "Beds", see: "Tomato" } }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Ripe",
            marks: [{ type: "index", attrs: { term: "Tomato" } }],
          },
        ],
      },
    ],
  };
  const refreshed = refreshIndex(doc);
  expect(refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Beds, see Tomato",
    "Tomato, section 1",
  ]);
  expect(JSON.stringify(refreshed.content?.[0])).not.toContain("secret-value");
  expect(doc.content[1].content?.[0].text).toBe("secret-value");
});

it("leaves an index term that is only an invisible character out", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] as { content?: { text?: string }[] }[] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Beds",
            marks: [
              { type: "index", attrs: { term: "\u200b" } },
              { type: "index", attrs: { term: "\u200bBeds", see: "\u200b" } },
              { type: "index", attrs: { term: "Be\u200bds" } },
            ],
          },
        ],
      },
    ],
  };
  const before = JSON.stringify(doc);
  const lines = refreshIndex(doc).content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(lines).toEqual(["Beds, section 1", "Be\u200bds, section 1"]);
  expect(JSON.stringify(doc)).toBe(before);
});

it("keeps an index line on one line and drops a blank see", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Beds",
            marks: [{ type: "index", attrs: { term: "Tomato\nbeds", see: " \n " } }],
          },
        ],
      },
    ],
  };
  const lines = refreshIndex(doc).content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(lines).toEqual(["Tomato beds, section 1"]);
  expect(lines?.[0]).not.toContain("\n");
  expect(lines?.[0]).not.toContain("see");
});

it("drops a see that names the same term", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Beds",
            marks: [{ type: "index", attrs: { term: "Beds", see: "beds" } }],
          },
        ],
      },
    ],
  };
  const lines = refreshIndex(doc).content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(lines).toEqual(["Beds, section 1"]);
  expect(lines?.[0]).not.toContain("see");
  expect(doc.content[1].content?.[0].text).toBe("Beds");
});

it("rebuilds a stale index before writing the Word file", async () => {
  const file = createFile("doc", "Report") as DocFile;
  file.content = {
    type: "doc",
    content: [
      {
        type: "index",
        content: [{ type: "paragraph", content: [{ type: "text", text: "secret-value" }] }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Beds are north",
            marks: [{ type: "index", attrs: { term: "Tomato" } }],
          },
        ],
      },
    ],
  } as DocFile["content"];
  const xml = await (await JSZip.loadAsync(await exportDocx(file))).file("word/document.xml")!.async("string");
  expect(xml).toContain("Tomato, section 1");
  expect(xml).not.toContain("secret-value");
  expect(JSON.stringify(file.content)).toContain("secret-value");
});

it("indexes a term marked in a note and leaves the note text out", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] as { content?: { text?: string }[] }[] },
      {
        type: "note",
        attrs: { id: "n1", kind: "footnote" },
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "secret-value " },
              { type: "text", text: "beds", marks: [{ type: "index", attrs: { term: "Beds" } }] },
            ],
          },
        ],
      },
    ],
  };
  const refreshed = refreshIndex(doc);
  expect(refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Beds, section 1",
  ]);
  expect(JSON.stringify(refreshed.content?.[0])).not.toContain("secret-value");
  expect(doc.content[1].content?.[0].content?.[0].text).toBe("secret-value ");
});

it("warns when an index see names a term that is not marked", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] as { content?: { text?: string }[] }[] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Ripe",
            marks: [{ type: "index", attrs: { term: "Beds", see: "Paths" } }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Kept",
            marks: [{ type: "index", attrs: { term: "Beds", see: "secret-value" } }],
          },
        ],
      },
    ],
  };
  const refreshed = refreshIndex(doc);
  expect(refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Beds, see Paths. That index term is missing.",
    "Beds. That index term is missing.",
  ]);
  expect(JSON.stringify(refreshed.content?.[0])).not.toContain("secret-value");
  expect(doc.content[2].content?.[0].text).toBe("Kept");
});

it("adds see also when that term is marked and hides a missing credential", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] as { content?: { text?: string }[] }[] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Ripe",
            marks: [{ type: "index", attrs: { term: "Beds", seeAlso: "Paths" } }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Walk",
            marks: [{ type: "index", attrs: { term: "Paths" } }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Kept",
            marks: [{ type: "index", attrs: { term: "Fees", seeAlso: "secret-value" } }],
          },
        ],
      },
    ],
  };
  const refreshed = refreshIndex(doc);
  expect(refreshed.content?.[0].content?.map((paragraph) => paragraph.content?.[0].text)).toEqual([
    "Beds, section 1. See also Paths",
    "Fees, section 1. That index term is missing.",
    "Paths, section 1",
  ]);
  expect(JSON.stringify(refreshed.content?.[0])).not.toContain("secret-value");
  expect(doc.content[3].content?.[0].text).toBe("Kept");
});

it("restarts an index page at the section break", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "index", content: [] as { content?: { text?: string }[] }[] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Beds", marks: [{ type: "index", attrs: { term: "Tomato" } }] },
        ],
      },
      { type: "sectionBreak", attrs: { restartAt: 5 } },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Walk", marks: [{ type: "index", attrs: { term: "Paths" } }] },
        ],
      },
    ],
  };
  const settings = { ...defaultPageSettings, pageNumbers: true };
  const lines = refreshIndex(doc, settings).content?.[0].content?.map(
    (paragraph) => paragraph.content?.[0].text,
  );
  expect(lines).toEqual(["Paths, 5", "Tomato, 1"]);
  const continued = refreshIndex(
    {
      ...doc,
      content: [
        doc.content[0],
        doc.content[1],
        { type: "sectionBreak", attrs: { restartAt: "secret-value" } },
        doc.content[3],
      ],
    },
    settings,
  ).content?.[0].content?.map((paragraph) => paragraph.content?.[0].text);
  expect(continued).toEqual(["Paths, 2", "Tomato, 1"]);
  expect(JSON.stringify(continued)).not.toContain("secret-value");
  expect(doc.content[2].attrs.restartAt).toBe(5);
});

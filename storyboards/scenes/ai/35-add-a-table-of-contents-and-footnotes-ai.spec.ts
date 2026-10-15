import { createFile, serializeFile, type JsonNode } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, beat, caption, describeRun, expect, test } from "../harness";

const fill = (line: string, times = 6) => `${line} `.repeat(times).trim();
const heading = (level: number, text: string): JsonNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const ATTENDANCE_SOURCE =
  "Annual return of the Saturday league, table 4, filed with the community fund on 12 March 2026. Players who made at least half the sessions, excluding the two weekends cancelled for snow.";

const PROMPT = `Leave every existing paragraph unchanged. Do not replace the document. Rename the heading Results to What we achieved. After the paragraph "Programme ends here.", add a Heading 2 called Coaching hours. Move the Budget heading and its paragraphs through "Budget close." so Budget sits immediately before What we achieved. Leave Partnerships where it is. Insert a table of contents with page numbers just before the paragraph "Start of the report". Add a footnote at the end of each of these paragraphs, and do not type the numbers. The paragraph containing "The charity coaches" gets the source Charity registration. The paragraph containing "attendance rose 40%" gets the source: ${ATTENDANCE_SOURCE} The paragraph containing "The secondary school lends" gets the source Pitch agreement. The paragraph containing "We want a second pitch" gets the source Club development plan.`;

const HEADINGS = [
  { level: "H1", text: "Introduction" },
  { level: "H2", text: "Who we serve" },
  { level: "H1", text: "Programme" },
  { level: "H2", text: "Coaching hours" },
  { level: "H1", text: "Budget" },
  { level: "H1", text: "What we achieved" },
  { level: "H2", text: "Attendance" },
  { level: "H2", text: "Partnerships" },
  { level: "H1", text: "Next year" },
];

/** The same "Grant report 2026" the human storyboard opens. */
async function seedReport(page: Page) {
  const file = createFile("doc", "Grant report 2026");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Grant report 2026",
            marks: [{ type: "textStyle", attrs: { fontSize: "26pt" } }],
          },
        ],
      },
      paragraph("Youth football charity. Prepared by Kwame Mensah for the community fund."),
      { type: "pageBreak" },
      paragraph("Start of the report"),
      heading(1, "Introduction"),
      paragraph(fill("The charity coaches young players after school and on Saturdays.")),
      heading(2, "Who we serve"),
      paragraph(fill("Most of the players are between eight and sixteen, and train near home.")),
      heading(1, "Programme"),
      paragraph(fill("Weekday sessions cover skills, and Saturday is a full league fixture.")),
      paragraph("Programme ends here."),
      heading(1, "Results"),
      heading(2, "Attendance"),
      paragraph("Across the season attendance rose 40%."),
      paragraph(fill("The Saturday league was full, and the waiting list finally moved.")),
      heading(1, "Budget"),
      paragraph(fill("Coaching, pitches and kit are the three costs the funder asked us to show.", 10)),
      paragraph("Budget close."),
      heading(2, "Partnerships"),
      paragraph(fill("The secondary school lends the pitch, and a local shop sponsors the kit.")),
      heading(1, "Next year"),
      paragraph(fill("We want a second pitch and a girls' team on weeknights.")),
    ],
  };
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  });
  await page.reload();
  await page.getByRole("link", { name: "Grant report 2026" }).waitFor();
}

test("35-add-a-table-of-contents-and-footnotes-ai", async ({ page }) => {
  await seedReport(page);
  await caption(page, "Kwame asks the on-device assistant for a contents page and footnotes.");
  await page.getByRole("link", { name: "Grant report 2026" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.getByRole("heading", { name: "Introduction" })).toBeVisible();

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const headings = await editor.locator("h1, h2, h3").evaluateAll((els) =>
    els.map((el) => ({ level: el.tagName, text: el.textContent?.trim() ?? "" })),
  );
  expect(headings, why).toEqual(HEADINGS);

  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc, why).toBeVisible();
  const labels = (await toc.locator(".doc-toc-link").allTextContents()).map((text) => text.trim());
  expect(labels, why).toEqual(HEADINGS.map((item) => item.text));
  await expect(toc.locator(".doc-toc-page").first(), why).not.toHaveText("");
  const pages = await toc.locator(".doc-toc-page").allTextContents();
  expect(pages, why).toHaveLength(HEADINGS.length);
  expect(pages.every((pageNumber) => pageNumber.trim() !== ""), why).toBe(true);

  const refs = await editor.locator(".doc-note-ref").evaluateAll((els) =>
    els.map((el) => ({
      n: el.textContent?.trim() ?? "",
      paragraph: el.closest("p, h1, h2, h3")?.textContent ?? "",
    })),
  );
  expect(refs.map((ref) => ref.n), why).toEqual(["1", "2", "3", "4"]);
  expect(refs[0].paragraph, why).toContain("The charity coaches");
  expect(refs[1].paragraph, why).toContain("attendance rose 40%");
  expect(refs[2].paragraph, why).toContain("The secondary school lends");
  expect(refs[3].paragraph, why).toContain("We want a second pitch");

  const bodies = await editor.locator(".doc-note[data-kind='footnote'] .doc-note-body").allTextContents();
  expect(bodies, why).toHaveLength(4);
  expect(bodies[0], why).toContain("Charity registration");
  expect(bodies[1], why).toContain("Saturday league");
  expect(bodies[1], why).toContain("table 4");
  expect(bodies[2], why).toContain("Pitch agreement");
  expect(bodies[3], why).toContain("Club development plan");

  await caption(page, "The contents list the finished headings, and the four footnotes are numbered in reading order.", 2000);
  await beat(page, 600);
});

import { createFile, serializeFile, type JsonNode } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, beat, caption, describeRun, expect, test } from "../harness";

const heading = (level: number, text: string): JsonNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (content: JsonNode["content"]): JsonNode => ({
  type: "paragraph",
  content,
});
const text = (value: string): JsonNode => ({ type: "text", text: value });

const PROMPT = `Leave every existing paragraph, the table of contents, and the footnote unchanged. Do not type a citation or a bibliography as text, and do not add another footnote. Use APA, and leave every source's page blank. Add three sources, one at a time: Mensah, a book titled Youth football in Accra, year 2024; Boateng, an article titled Coaching hours, year 2023; and Adu, a book titled Unused notes, year 2020. Cite Mensah at the end of the paragraph that contains "attendance rose 40%". Cite Boateng at the end of the paragraph that contains "The extra coaching hours changed the season". Do not cite Unused notes. Then change Mensah's year from 2024 to 2022. Insert the APA bibliography after the paragraph that contains "filed its return". The references must list Boateng 2023 and then Mensah 2022. Unused notes must not appear.`;

/** The same Grant report 2026 the human storyboard opens, with its contents and footnote. */
async function seedReport(page: Page) {
  const file = createFile("doc", "Grant report 2026");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      paragraph([text("Grant report 2026")]),
      { type: "tableOfContents", attrs: { pageNumbers: true, maxLevel: 3 } },
      heading(1, "Results"),
      paragraph([text("Attendance rose 40%")]),
      heading(1, "Coaching"),
      paragraph([text("The extra coaching hours changed the season")]),
      paragraph([
        text("The Saturday league filed its return"),
        { type: "noteReference", attrs: { id: "fn1", kind: "footnote", label: "1" } },
        text("."),
      ]),
      {
        type: "note",
        attrs: { id: "fn1", kind: "footnote", label: "1" },
        content: [paragraph([text("League register, 2025.")])],
      },
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

test("50-cite-a-source-ai", async ({ page }) => {
  await seedReport(page);
  await caption(page, "Kwame asks the on-device assistant to cite the report and add a bibliography.");
  await page.getByRole("link", { name: "Grant report 2026" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.getByText("Attendance rose 40%")).toBeVisible();
  await expect(editor.locator(".doc-note")).toContainText("League register, 2025");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const attendance = editor.locator("p", { hasText: "Attendance rose 40%" });
  const coaching = editor.locator("p", { hasText: "The extra coaching hours changed the season" });
  await expect(attendance, why).toHaveText("Attendance rose 40% (Mensah, 2022)");
  await expect(attendance.getByRole("button", { name: "Citation Mensah, 2022" }), why).toHaveText("(Mensah, 2022)");
  await expect(coaching, why).toHaveText("The extra coaching hours changed the season (Boateng, 2023)");
  await expect(coaching.getByRole("button", { name: "Citation Boateng, 2023" }), why).toHaveText("(Boateng, 2023)");
  await expect(editor.locator(".doc-citation"), why).toHaveCount(2);

  const bibliography = editor.getByRole("region", { name: "References" });
  const entries = bibliography.locator(".doc-bib-entry");
  await expect(entries, why).toHaveCount(2);
  await expect(entries.nth(0), why).toHaveText("Boateng. (2023). Coaching hours.");
  await expect(entries.nth(1), why).toHaveText("Mensah. (2022). Youth football in Accra.");
  await expect(bibliography, why).not.toContainText("Unused notes");
  await expect(bibliography, why).not.toContainText("#");
  await expect(editor, why).not.toContainText("Unused notes");
  await expect(editor.locator(".doc-note"), why).toContainText("League register, 2025");

  await caption(page, "Mensah 2022 and Boateng 2023 are cited in the text, and the references leave out Unused notes.", 2000);
  await beat(page, 600);
});

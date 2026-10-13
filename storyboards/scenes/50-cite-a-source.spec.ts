import type { Locator, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { createFile, serializeFile, type JsonNode } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

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

async function pointAt(page: Page, target: Locator, dx = 0.5, dy = 0.5) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 8 });
}

async function scrollStage(target: Locator, offset = 72) {
  await target.evaluate((el, top) => {
    const stage = el.closest(".document-stage") as HTMLElement | null;
    if (!stage) return;
    const rect = el.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    stage.scrollTop += rect.top - frame.top - top;
  }, offset);
}

async function seedReport(page: Page) {
  const file = createFile("doc", "Grant report 2026");
  if (file.kind !== "doc") throw new Error();
  file.content = {
    type: "doc",
    content: [
      paragraph([
        text("Grant report 2026"),
      ]),
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
  const native = serializeFile(file);
  await page.goto("/");
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.evaluate(
    async ({ id, title, updatedAt, native }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("SuiteLeaf");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("encoded", "readwrite");
          tx.objectStore("encoded").put({ id, title, updatedAt, native });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { id: file.id, title: file.title, updatedAt: file.updatedAt, native },
  );
  await page.reload();
}

async function addSource(
  page: Page,
  kind: "Book" | "Article",
  author: string,
  title: string,
  year: string,
) {
  const panel = page.getByRole("complementary", { name: "Citations" });
  await panel.getByRole("button", { name: "Add citation source" }).click();
  if (kind === "Article") await panel.getByRole("button", { name: "Article" }).click();
  await panel.getByRole("textbox", { name: "Author", exact: true }).click();
  await typeSlowly(page, author, 40);
  await panel.getByRole("textbox", { name: "Title", exact: true }).click();
  await typeSlowly(page, title, 28);
  await panel.getByRole("textbox", { name: "Year", exact: true }).click();
  await typeSlowly(page, year, 80);
  await beat(page, 400);
  await panel.getByRole("button", { name: "Add source" }).click();
}

test("50-cite-a-source", async ({ page }) => {
  await seedReport(page);
  await caption(page, "Kwame opens Grant report 2026. The contents and the footnote are already there.");
  const report = page.getByRole("link", { name: /Grant report 2026/ });
  await expect(report).toBeVisible();
  await pointAt(page, report, 0.3);
  await beat(page, 500);
  await report.click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  const toc = editor.getByRole("navigation", { name: "Table of contents" });
  await expect(toc.getByRole("button", { name: "Results" })).toBeVisible();
  await expect(editor.locator(".doc-note-ref")).toHaveText("1");
  const note = editor.locator(".doc-note");
  await scrollStage(note, 160);
  await expect(note).toBeVisible();
  await expect(note).toContainText("League register, 2025");
  await pointAt(page, note, 0.3, 0.5);
  await caption(page, "The contents are at the top. Footnote 1 sits at the bottom of the page.", 1800);
  await scrollStage(editor.getByRole("heading", { name: "Results" }), 24);
  await beat(page, 400);

  await caption(page, "Tools, Citations. The panel opens on APA. MLA and Chicago are beside it.", 1200);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Citations" }).click();
  const panel = page.getByRole("complementary", { name: "Citations" });
  await expect(panel.getByRole("radio", { name: "APA" })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "MLA" })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Chicago" })).toBeVisible();
  await beat(page, 800);

  await caption(page, "He adds Mensah’s book: author, title, and year. The page stays blank, so no # appears.");
  await addSource(page, "Book", "Mensah", "Youth football in Accra", "2024");
  await expect(panel.getByText("(Mensah, 2024)")).toBeVisible();
  await beat(page, 600);

  await caption(page, "A second source: Boateng’s article, Coaching hours, 2023.");
  await addSource(page, "Article", "Boateng", "Coaching hours", "2023");
  await expect(panel.getByRole("button", { name: "Cite Boateng" })).toBeVisible();
  await beat(page, 500);

  await caption(page, "After “attendance rose 40%” he clicks Cite. One click.", 1000);
  await editor.getByText("Attendance rose 40%").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await beat(page, 300);
  await pointAt(page, panel.getByRole("button", { name: "Cite Mensah" }));
  await panel.getByRole("button", { name: "Cite Mensah" }).click();
  const mensah = editor.getByRole("button", { name: "Citation Mensah, 2024" });
  await expect(mensah).toHaveText("(Mensah, 2024)");
  await beat(page, 700);

  await caption(page, "After the coaching paragraph, he cites Boateng. Each citation is part of the sentence.");
  await editor.getByText("coaching hours changed the season").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await panel.getByRole("button", { name: "Cite Boateng" }).click();
  const boateng = editor.getByRole("button", { name: "Citation Boateng, 2023" });
  await expect(boateng).toHaveText("(Boateng, 2023)");
  await beat(page, 700);

  await caption(page, "Clicking Mensah’s citation selects that source in the panel.");
  await pointAt(page, mensah);
  await mensah.click();
  await expect(panel.locator(".doc-citation-source.is-selected")).toContainText("Mensah");
  await beat(page, 900);

  await caption(page, "He adds a third source, Unused notes, and never cites it.");
  await addSource(page, "Book", "Adu", "Unused notes", "2020");
  await expect(panel.getByText("Not cited")).toBeVisible();
  await beat(page, 600);

  await caption(page, "Insert bibliography. APA lists the cited sources alphabetically. Unused notes stays out.", 1400);
  await editor.getByText("filed its return").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await panel.getByRole("button", { name: "Insert bibliography" }).click();
  const bibliography = editor.getByRole("region", { name: "References" });
  await scrollStage(editor.getByText("Attendance rose 40%"), 16);
  const entries = bibliography.locator(".doc-bib-entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Boateng");
  await expect(entries.nth(1)).toContainText("Mensah");
  await expect(bibliography).not.toContainText("Unused notes");
  await expect(bibliography).not.toContainText("#");
  await pointAt(page, bibliography, 0.4, 0.5);
  await beat(page, 1200);

  await caption(page, "He changes Mensah’s year to 2022. The citation and the references both follow. Nothing to refresh.", 1200);
  const year = panel.getByRole("textbox", { name: "Year for Mensah" });
  await year.click();
  await year.fill("2022");
  const mensahNow = editor.locator(".doc-citation").nth(0);
  await expect.poll(async () => mensahNow.innerText(), { timeout: 1000 }).toBe("(Mensah, 2022)");
  await expect(entries.nth(1)).toContainText("(2022)");
  await beat(page, 1200);

  await caption(page, "File, Export DOCX. Word gets citation fields, a bibliography field, and the sources.", 1200);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const download = await downloadPromise;
  const saved = await download.path();
  const bytes = await readFile(saved!);
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const sourceXml = (
    await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^customXml\/item\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    )
  ).join("\n");
  expect(documentXml).toMatch(/CITATION\s+Men24/);
  expect(documentXml).toMatch(/CITATION\s+Boa23/);
  expect(documentXml).toMatch(/BIBLIOGRAPHY/);
  expect(documentXml).toMatch(/<w:footnoteReference\b/);
  expect(documentXml).toMatch(/\bTOC\b/);
  expect(sourceXml).toContain("Mensah");
  expect(sourceXml).toContain("Youth football in Accra");
  expect(sourceXml).toContain("2022");
  expect(sourceXml).toContain("Boateng");
  expect(sourceXml).toContain("Coaching hours");
  expect(await zip.file("word/footnotes.xml")!.async("string")).toContain("League register");
  await caption(page, "The Word file still has the contents field and the footnote, plus real citations.", 1800);

  await caption(page, "The funder’s officer sends the same file back, citations unedited.", 1200);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Grant report 2026 returned.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: bytes,
  });
  await expect(page.locator(".import-notes summary")).toContainText(
    "2 citations, 1 bibliography",
  );
  await caption(page, "The import summary counts 2 citations and 1 bibliography. They are still citations.", 1800);
  const imported = page.getByRole("textbox", { name: "Document content" });
  await expect(imported.getByRole("navigation", { name: "Table of contents" })).toBeVisible();
  await expect(imported.locator(".doc-note-ref")).toHaveText("1");
  const mensahBack = imported.locator(".doc-citation").nth(0);
  const boatengBack = imported.locator(".doc-citation").nth(1);
  await expect(mensahBack).toHaveText("(Mensah, 2022)");
  await expect(boatengBack).toHaveText("(Boateng, 2023)");
  await expect(imported.getByRole("region", { name: "References" })).toContainText("Youth football in Accra");
  await expect(imported.getByRole("region", { name: "References" })).not.toContainText("Unused notes");

  await caption(page, "He changes Boateng’s year to 2021. The citation and the bibliography update together.", 1200);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Citations" }).click();
  const again = page.getByRole("complementary", { name: "Citations" });
  await again.getByRole("textbox", { name: "Year for Boateng" }).fill("2021");
  await expect
    .poll(async () => imported.locator(".doc-citation").nth(1).innerText(), { timeout: 1000 })
    .toBe("(Boateng, 2021)");
  await expect(imported.getByRole("region", { name: "References" })).toContainText("(2021)");
  await expect(again.getByText("Youth football in Accra")).toBeVisible();
  await expect(again.getByText("Coaching hours")).toBeVisible();
  await pointAt(page, boatengBack);
  await caption(page, "Mensah 2022 and Boateng 2021 are still linked sources, in the same two places in the text.", 2200);
});

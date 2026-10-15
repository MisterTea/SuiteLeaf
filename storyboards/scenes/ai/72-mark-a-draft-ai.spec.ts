import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  "Garden club minutes is open. Put the word DRAFT behind the text on every page. Do not type DRAFT into a paragraph. Call page_setup once with watermark DRAFT. Stop.";

const pageOne = [
  "The committee met on Sunday 12 October in the potting shed. Present: Priya, Ruth, Marek and Asha. Apologies: Tom.",
  "Ruth reported that the rainwater tanks are in. The harvest supper is Saturday 7 November.",
  "Asha will book the village hall. Marek will print the plot map. Priya will write to members who missed the meeting.",
  "The tool library needs a new lock. The compost bay is full, so the next work party will turn it.",
  "Marek will seal the cracked pane in the greenhouse before the first frost.",
];

const pageTwo = [
  "The club agreed to keep the subscription at five pounds.",
  "The tool library opens on the first Saturday of each month.",
  "Next meeting: 2 November, 10 am, in the potting shed. Please bring spare seed packets.",
];

/** Garden club minutes, as the storyboard seeds them: two pages and no watermark. */
function minutes(): DocFile {
  const file = createFile("doc", "Garden club minutes") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const heading = (text: string) => ({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: { pageSettings: { watermark: "" } },
    content: [
      heading("Garden club minutes"),
      ...pageOne.map(paragraph),
      { type: "pageBreak" },
      heading("Decisions"),
      ...pageTwo.map(paragraph),
    ],
  };
  return file;
}

async function savedMinutes(page: Page) {
  const native = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const rows = await new Promise<{ title?: string; native?: string }[]>((resolve, reject) => {
      const tx = db.transaction("encoded", "readonly");
      const request = tx.objectStore("encoded").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = rows.find((item) => item.title === "Garden club minutes");
    if (!row?.native) throw new Error("Garden club minutes was not saved");
    return row.native;
  });
  return JSON.parse(native) as {
    title?: string;
    content?: { attrs?: { pageSettings?: { watermark?: unknown } }; content?: unknown[] };
  };
}

/** Text nodes in the document body. Page settings, including the watermark, are not walked. */
function bodyTexts(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const record = node as { text?: unknown; content?: unknown };
  const own = typeof record.text === "string" ? [record.text] : [];
  const children = Array.isArray(record.content) ? record.content.flatMap(bodyTexts) : [];
  return [...own, ...children];
}

test("72-mark-a-draft-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Garden club minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.locator("h1").first()).toHaveText("Garden club minutes");
  await expect(editor).toContainText("Asha will book the village hall.");
  await expect(editor).toContainText("2 November");
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-watermark")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Saved");
  const before = await savedMinutes(page);
  expect(before.content?.attrs?.pageSettings?.watermark ?? "").toBe("");
  expect(bodyTexts(before.content).join("\n")).not.toContain("DRAFT");
  await caption(page, "Priya asks the on-device assistant to put DRAFT behind the minutes.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  await expect
    .poll(async () => (await savedMinutes(page)).content?.attrs?.pageSettings?.watermark ?? "", { timeout: 10000 })
    .toBe("DRAFT");
  const saved = await savedMinutes(page);
  expect(saved.content?.attrs?.pageSettings?.watermark, why).toBe("DRAFT");
  const body = bodyTexts(saved.content).join("\n");
  expect(body, why).not.toContain("DRAFT");
  expect(body, why).toContain("Asha will book the village hall.");
  expect(body, why).toContain("2 November");
  expect(body, why).toContain("Garden club minutes");
  await expect(editor, why).not.toContainText("DRAFT");
  await expect(editor, why).toContainText("Asha will book the village hall.");
  await expect(editor.locator(".page-watermark"), why).toHaveCount(0);
  const marks = page.locator(".page-watermark");
  await expect(marks, why).toHaveCount(2);
  await expect(marks, why).toHaveText(["DRAFT", "DRAFT"]);
  const paint = await marks.evaluateAll((nodes) =>
    nodes.map((node) => {
      const span = node.querySelector("span") ?? node;
      const style = getComputedStyle(span);
      const color = style.color;
      const alpha = Number(color.split(",").pop()?.replace(")", "").trim());
      return {
        fontSize: parseFloat(style.fontSize),
        alpha,
        inParagraph: !!node.closest("p, h1, h2, li"),
      };
    }),
  );
  expect(paint, why).toHaveLength(2);
  for (const word of paint) {
    expect(word.fontSize, why).toBeGreaterThan(80);
    expect(word.alpha, why).toBeGreaterThan(0);
    expect(word.alpha, why).toBeLessThan(0.6);
    expect(word.inParagraph, why).toBe(false);
  }
});

import { serializeFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { CHART_ALT, CHART_NOTES, NEXT_NOTES, q3Update } from "../../../tests/q3-comment-deck";
import { askAgent, caption, describeRun, expect, openApp, test } from "../harness";

const PROMPT =
  'Q3 update is open on the chart slide. Add a comment on the chart, signed Maria: Use the September numbers. Reply in that same thread: Priya has them. Do not put either note in the speaker notes, and do not resolve the thread. Call add_slide_comment with object "chart", text "Use the September numbers", and signed_as "Maria". Then call reply_slide_comment with object "chart", text "Priya has them.", and signed_as "Maria". Stop.';

async function seedDeck(page: Page) {
  await page.evaluate(async (native) => {
    const file = JSON.parse(native) as { id: string; title: string; updatedAt: string };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("SuiteLeaf");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put({ id: file.id, title: file.title, updatedAt: file.updatedAt, native });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, serializeFile(q3Update()));
  await page.reload();
}

type SavedMessage = { authorName?: string; text?: string };
type SavedThread = { elementId?: string; resolved?: boolean; messages?: SavedMessage[] };
type SavedSlide = { notes?: string; comments?: SavedThread[]; elements?: { id?: string }[] };
type SavedFile = { content: { slideOrder: string[]; slides: Record<string, SavedSlide> } };

async function savedDeck(page: Page): Promise<SavedFile | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("SuiteLeaf");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const rows = await new Promise<{ title?: string; native?: string | Blob }[]>((resolve, reject) => {
      const tx = db.transaction("encoded", "readonly");
      const req = tx.objectStore("encoded").getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const row = rows.find((item) => item.title === "Q3 update");
    if (!row?.native) return null;
    const text = typeof row.native === "string" ? row.native : await row.native.text();
    return JSON.parse(text) as SavedFile;
  });
}

test("60-comment-on-a-slide-ai", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: "New presentation" })).toBeVisible();
  await seedDeck(page);
  await expect(page.getByRole("link", { name: "Q3 update", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Q3 update", exact: true }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Q3 update");
  await expect(page.getByRole("option", { name: "Slide 1: Chart" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".slide-canvas .slide-image img")).toHaveAttribute("alt", CHART_ALT);
  await expect(page.locator(".notes-textarea")).toHaveValue(CHART_NOTES);
  await expect(page.locator(".slide-comment-mark")).toHaveCount(0);
  await caption(page, "Maria asks for a note on the chart, and a reply in that same thread.");
  await caption(page, "", 0);

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  let saved: SavedFile | null = null;
  await expect
    .poll(
      async () => {
        saved = await savedDeck(page);
        const chart = Object.values(saved?.content.slides ?? {}).find((slide) => slide.elements?.some((el) => el.id === "chart"));
        const thread = chart?.comments?.[0];
        return thread?.messages?.map((message) => message.text).join("|") ?? "";
      },
      { timeout: 15000 },
    )
    .toBe("Use the September numbers|Priya has them.");

  const slides = Object.values(saved!.content.slides);
  const chart = slides.find((slide) => slide.elements?.some((el) => el.id === "chart"));
  const next = slides.find((slide) => slide.elements?.some((el) => el.id === "next-title"));
  expect(chart, why).toBeTruthy();
  expect(next, why).toBeTruthy();
  expect(chart!.comments, why).toHaveLength(1);
  const thread = chart!.comments![0];
  expect(thread.elementId, why).toBe("chart");
  expect(thread.resolved, why).not.toBe(true);
  expect(thread.messages?.map((message) => message.text), why).toEqual(["Use the September numbers", "Priya has them."]);
  expect(thread.messages?.map((message) => message.authorName), why).toEqual(["Maria", "Maria"]);
  expect(next!.comments ?? [], why).toEqual([]);
  expect(chart!.notes, why).toBe(CHART_NOTES);
  expect(next!.notes, why).toBe(NEXT_NOTES);
  await caption(page, "The chart thread has both notes. The speaker notes are unchanged.", 1600);
});

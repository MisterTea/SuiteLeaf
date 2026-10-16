import type { Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const welcome =
  "Welcome to the October meeting of the Riverside Garden Club. We are glad you came to the greenhouse this evening. Before the frost we need to decide the south bed, and we want this welcome to stay easy to read while the vote itself stays compact. Please take a copy of the minutes and a seat near the door.";
const motion = [
  "Plant the south bed with beans.",
  "Second the motion and open the vote.",
  "The vote carries if members present agree.",
];

const PROMPT = [
  'Call set_line_spacing with text from the welcome paragraph and spacing "1.5". Call set_line_spacing with text from a motion line and spacing "double". Then stop.',
  "Garden club minutes is open.",
  "Set the welcome paragraph to 1.5 line spacing and the motion list to double.",
  "They must not share one spacing. Leave the Motion label single.",
  "Do not rewrite any paragraph. Do not call write_text.",
].join(" ");

function item(text: string): JsonNode {
  return {
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

async function seedMinutes(page: Page) {
  const file = createFile("doc", "Garden club minutes") as DocFile;
  file.content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: welcome }] },
      { type: "paragraph", content: [{ type: "text", text: "Motion" }] },
      { type: "bulletList", content: motion.map(item) },
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
  await page.getByRole("link", { name: /Garden club minutes/ }).waitFor();
}

type SavedNode = {
  type?: string;
  text?: string;
  attrs?: { lineSpacing?: string | null };
  content?: SavedNode[];
};

function textOf(node: SavedNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function paragraphRecords(node: SavedNode | undefined, inList = false): { text: string; spacing: string; list: boolean }[] {
  if (!node) return [];
  if (node.type === "paragraph") {
    const spacing = node.attrs?.lineSpacing;
    return [{ text: textOf(node), spacing: spacing === "1.5" || spacing === "double" || spacing === "1.15" ? spacing : "single", list: inList }];
  }
  const nextList = inList || node.type === "bulletList" || node.type === "orderedList" || node.type === "listItem";
  return (node.content ?? []).flatMap((child) => paragraphRecords(child, nextList));
}

async function savedMinutes(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const rows = await new Promise<{ title?: string; native?: string | Blob }[]>((resolve, reject) => {
      const tx = db.transaction("encoded", "readonly");
      const request = tx.objectStore("encoded").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = rows.find((item) => item.title === "Garden club minutes");
    if (!row?.native) return null;
    const text = typeof row.native === "string" ? row.native : await row.native.text();
    return JSON.parse(text) as { content?: SavedNode };
  });
}

test("68-space-the-lines-ai", async ({ page }) => {
  await seedMinutes(page);
  await caption(page, "Priya asks the on-device assistant to open the welcome to 1.5 and double-space the motion.");
  await page.getByRole("link", { name: /Garden club minutes/ }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("greenhouse");
  await expect(editor).toContainText("beans");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const expected = [
    { text: welcome, spacing: "1.5", list: false },
    { text: "Motion", spacing: "single", list: false },
    { text: motion[0], spacing: "double", list: true },
    { text: motion[1], spacing: "double", list: true },
    { text: motion[2], spacing: "double", list: true },
  ];
  let records: { text: string; spacing: string; list: boolean }[] = [];
  await expect
    .poll(
      async () => {
        const saved = await savedMinutes(page);
        records = paragraphRecords(saved?.content);
        const written = records.filter((record) => record.text !== "");
        return written.map((record) => `${record.list ? "list" : "text"}:${record.spacing}:${record.text}`).join("\n");
      },
      { timeout: 15000, message: why },
    )
    .toBe(expected.map((record) => `${record.list ? "list" : "text"}:${record.spacing}:${record.text}`).join("\n"));

  const written = records.filter((record) => record.text !== "");
  expect(written, why).toEqual(expected);
  expect(written[0]?.spacing, why).not.toBe(written[2]?.spacing);
  const blanks = records.filter((record) => record.text === "");
  expect(blanks.length, why).toBeLessThanOrEqual(1);
  expect(blanks.every((record) => record.spacing === "single" && !record.list), why).toBe(true);
  expect(records.findIndex((record) => record.text === ""), why).toBe(blanks.length ? written.length : -1);
  await caption(page, "The welcome stays at 1.5. The motion is double. The words are unchanged.", 1600);
});

import { createFile, serializeFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT = `Do these four calls in order, then stop. Do not type the math, a superscript, or x².
1. write_text with text "The model fits and the ratio."
2. insert_equation with expression x^2 and after "The model fits".
3. insert_equation with expression (a+b)/c and after "and the ratio".
4. edit_equation with symbol c and replacement d, so the fraction's denominator changes from c to d. Leave a+b and x^2.`;

/** The empty Methods note the human storyboard starts from, before the sentence. */
async function seedNote(page: Page) {
  const file = createFile("doc", "Methods");
  if (file.kind !== "doc") throw new Error("expected a document");
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
  await page.getByRole("link", { name: "Methods", exact: true }).waitFor();
}

test("56-insert-an-equation-ai", async ({ page }) => {
  await seedNote(page);
  await caption(page, "Amara asks the on-device assistant for a square and a fraction.");
  await page.getByRole("link", { name: "Methods", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible();

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const sentence = editor.locator("p", { hasText: "The model fits" });
  await expect(sentence, why).toContainText("and the ratio");
  await expect(sentence.locator(".eq"), why).toHaveCount(2);
  await expect(sentence.locator("sup"), why).toHaveCount(0);
  await expect(sentence, why).not.toContainText("x^2");
  await expect(sentence, why).not.toContainText("x²");
  await expect(sentence, why).not.toContainText("(a+b)/c");

  const square = sentence.locator(".eq[data-structure='sup']");
  await expect(square, why).toHaveCount(1);
  await expect(square.locator(".eq-base"), why).toHaveText("x");
  await expect(square.locator(".eq-exp"), why).toHaveText("2");

  const fraction = sentence.locator(".eq[data-structure='frac']");
  await expect(fraction, why).toHaveCount(1);
  await expect(fraction.locator(".eq-num"), why).toHaveText("a+b");
  await expect(fraction.locator(".eq-den"), why).toHaveText("d");

  const equations = await sentence.locator(".eq").evaluateAll((els) =>
    els.map((el) => {
      const node = (el as HTMLElement & { pmViewDesc?: { node?: { type: { name: string }; attrs: { expr: unknown } } } })
        .pmViewDesc?.node;
      return { type: node?.type.name ?? "", expr: node?.attrs.expr ?? null };
    }),
  );
  expect(equations, why).toEqual([
    {
      type: "equation",
      expr: {
        kind: "sup",
        base: { kind: "text", text: "x" },
        exp: { kind: "text", text: "2" },
      },
    },
    {
      type: "equation",
      expr: {
        kind: "frac",
        num: {
          kind: "row",
          items: [
            { kind: "text", text: "a" },
            { kind: "text", text: "+" },
            { kind: "text", text: "b" },
          ],
        },
        den: { kind: "text", text: "d" },
      },
    },
  ]);
});

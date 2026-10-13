import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { equationDocx } from "../../tests/office-fixtures";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

async function newDocument(page: Page, title: string) {
  await page.getByRole("button", { name: "New document" }).click();
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.click();
  await box.press("ControlOrMeta+A");
  await typeSlowly(page, title);
  const editor = editorOf(page);
  await editor.click();
  return editor;
}

async function backToFiles(page: Page) {
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

async function replaceSymbol(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: `Edit symbol ${from}` }).click();
  const input = page.locator(".eq-slot-input");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(from);
  await beat(page, 1100);
  await page.keyboard.type(to, { delay: 220 });
  await beat(page, 900);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: `Edit symbol ${to}` })).toBeVisible();
  await beat(page, 700);
}

test("56-insert-an-equation", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Amara is writing a methods note. She needs a real square and a real fraction.",
  );
  const editor = await newDocument(page, "Methods");
  await caption(page, "The caret stays in the sentence. Insert › Equation.", 900);
  await typeSlowly(page, "The model fits ");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Equation", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Equation" });
  await expect(dialog).toBeVisible();
  await caption(page, "She types x^2. The preview is a power, not two formatted characters.");
  await dialog.getByRole("textbox", { name: "Equation" }).click();
  await typeSlowly(page, "x^2", 90);
  await dialog.locator(".eq-sup").hover();
  await beat(page, 1400);
  await dialog.getByRole("button", { name: "Insert equation" }).click();
  await expect(dialog).toBeHidden();
  const square = editor.locator(".eq[data-structure='sup']");
  await expect(square.locator(".eq-exp")).toHaveText("2");
  await square.hover();
  await caption(page, "x with a raised 2 sits in the sentence, as math.", 1600);

  await caption(page, "She keeps writing, then inserts the ratio.");
  await typeSlowly(page, " and the ratio ");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await beat(page, 450);
  await page.getByRole("menuitem", { name: "Equation", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Equation" });
  await caption(page, "She types (a+b)/c. The numerator sits on a bar, and c sits under it.");
  await dialog.getByRole("textbox", { name: "Equation" }).click();
  await typeSlowly(page, "(a+b)/c", 80);
  const previewFraction = dialog.locator(".eq-frac");
  await expect(previewFraction.locator(".eq-den")).toHaveText("c");
  await previewFraction.hover();
  await beat(page, 1500);
  await dialog.getByRole("button", { name: "Insert equation" }).click();
  await typeSlowly(page, ".");
  const sentence = editor.locator("p", { hasText: "The model fits" });
  const fraction = sentence.locator(".eq[data-structure='frac']");
  await expect(sentence).toContainText("and the ratio");
  await expect(fraction.locator(".eq-den")).toHaveText("c");
  await fraction.hover();
  await caption(page, "Both equations stay in the sentence. The words around them keep their font.", 1600);
  const fonts = await sentence.evaluate((el) => {
    const word = [...el.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("fits"),
    );
    const wordFont = word?.parentElement
      ? getComputedStyle(word.parentElement).fontFamily
      : "";
    const equation = el.querySelector(".eq");
    return {
      wordFont,
      equationFont: equation ? getComputedStyle(equation).fontFamily : "",
    };
  });
  expect(fonts.wordFont).toContain("Arial");
  expect(fonts.equationFont).not.toBe(fonts.wordFont);

  await caption(page, "She clicks the denominator and changes c to d, without retyping the fraction.", 1200);
  await replaceSymbol(page, "c", "d");
  await expect(sentence).toContainText("The model fits");
  await expect(sentence).toContainText("and the ratio");
  await expect(sentence.locator(".eq")).toHaveCount(2);
  await fraction.hover();
  await beat(page, 600);
  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "The square and the fraction are part of the file. She leaves and comes back.", 1400);

  await backToFiles(page);
  await page.getByRole("link", { name: "Methods", exact: true }).click();
  await expect(editorOf(page).locator(".eq")).toHaveCount(2);
  await expect(editorOf(page).locator(".eq-exp")).toHaveText("2");
  await expect(editorOf(page).locator(".eq-den")).toHaveText("d");
  await editorOf(page).locator(".eq-frac").hover();
  await caption(page, "Opened again, both equations are still math she can edit.", 1600);

  await backToFiles(page);
  await caption(page, "A Word file already contains an equation. She opens it.", 1100);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Variance note.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(await equationDocx()),
  });
  const imported = editorOf(page);
  await expect(imported.locator(".eq[data-structure='sup']")).toBeVisible();
  await expect(imported).toContainText("The sample variance uses");
  await expect(imported.locator("sup")).toHaveCount(0);
  const notes = page.locator(".import-notes");
  await expect(notes).not.toContainText("equation layout is not supported");
  await notes.locator("summary").click();
  await beat(page, 400);
  await caption(
    page,
    "It is still an equation. The compatibility note does not say equation layout is unsupported.",
    2000,
  );
  await caption(page, "She clicks the exponent and changes 2 to 3.", 600);
  await replaceSymbol(page, "2", "3");
  await expect(imported.locator(".eq-exp")).toHaveText("3");
  await imported.locator(".eq").hover();
  await beat(page, 800);

  await caption(page, "She exports to Word. The equation goes back as Office math, not a picture.", 800);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 450);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const bytes = readFileSync((await (await download).path())!);
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  expect(xml).toContain("<m:oMath");
  expect(xml).toContain("<m:sSup");
  expect(xml).toContain("<m:t>3</m:t>");
  expect(xml).not.toContain("<w:drawing");

  await backToFiles(page);
  const again = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await again
  ).setFiles({
    name: "Variance note round trip.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: bytes,
  });
  const roundTrip = editorOf(page);
  await expect(roundTrip.locator(".eq[data-structure='sup'] .eq-exp")).toHaveText("3");
  await expect(page.locator(".import-notes")).not.toContainText("equation layout is not supported");
  await roundTrip.locator(".eq").hover();
  await caption(page, "Opened again, Word's equation is still math. Nothing came back as a picture.", 2000);
});

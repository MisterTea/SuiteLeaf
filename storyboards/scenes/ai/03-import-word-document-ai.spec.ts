import { wordFixture } from "../../../tests/office-fixtures";
import { askAgent, beat, caption, describeRun, electronMode, expect, openApp, test } from "../harness";

const note = "Reviewed by Lena: figures confirmed with the North team.";

test("03-import-word-document-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Lena was emailed a Word document. She asks SuiteLeaf's on-device assistant to open it and add her note.");
  const run = await askAgent(
    page,
    `Open the Word document I was emailed. Then on a new line after "40 m²" add this note, in normal text, not superscript: ${note}`,
    {
      files: [
        {
          name: "Office field notes.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: Buffer.from(await wordFixture()),
        },
      ],
    },
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(page.getByLabel("File title"), why).toHaveValue("Office field notes");
  await expect(editor.locator("h1"), why).toContainText("Office field notes");
  await expect(page.locator(".outline"), why).toContainText("Office field notes");
  await expect(editor.locator("strong em, em strong").first(), why).toContainText("Hello 世界 — مرحبا");
  await expect(editor.locator("table"), why).toBeVisible();
  await expect(editor.locator('a[href="https://example.org"]'), why).toHaveText("Reference");
  await expect(editor.locator('a[href^="javascript:"]'), why).toHaveCount(0);
  await expect(editor, why).toContainText("Unsafe link");
  await expect(editor.locator("sup"), why).toHaveText("2");
  await caption(page, "Gemma had her choose the file, and it converted on this computer into an editable copy.", 2200);

  const last = editor.locator(":scope > p").last();
  await expect(last, why).toHaveText(note);
  await expect(last.locator("sup"), why).toHaveCount(0);
  await expect(editor.locator(":scope > p").nth(-2), why).toHaveText("North plot: 40 m2");
  await last.scrollIntoViewIfNeeded();
  await caption(page, "Her note is on a new line after \"40 m²\", in normal text. The ² stays superscript.", 2400);

  const notes = page.locator(".import-notes");
  await expect(notes.locator("summary")).toHaveText("Imported DOCX: Office field notes.docx · 2 compatibility notes");
  await notes.locator("summary").click();
  await expect(notes.locator("li")).toHaveText([
    /1 link with an unsafe or unsupported address \(javascript:\) was removed; its text was kept\./,
    /SuiteLeaf lays out its own pages/,
  ]);
  await caption(page, "The banner lists what didn't come across: an unsafe 'javascript:' link was removed, and page breaks may differ.", 2600);
  await notes.locator("summary").click();

  if (electronMode) {
    await expect(page.getByRole("status")).toContainText("Draft saved");
    await caption(page, "The desktop app keeps her edits as a draft until she chooses Save As. The original .docx was never changed.", 2200);
  } else {
    await expect(page.getByRole("status")).toContainText("Saved on this device");
    await caption(page, "It saved on this device. The original .docx was never changed.", 1600);
  }

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: /^Office field notes/ }).click();
  await expect(editor.locator(":scope > p").last()).toHaveText(note);
  await caption(page, "Reopened from her library, the copy has her note.", 1800);
  await beat(page, 600);
});

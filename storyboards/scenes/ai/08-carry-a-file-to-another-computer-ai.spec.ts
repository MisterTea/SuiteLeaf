import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test } from "../harness";

const title = "Lisbon trip packing list";
const items = ["Passport and boarding pass", "Plug adapter", "Walking shoes", "Rain jacket"];

test("08-carry-a-file-to-another-computer-ai", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-08-ai-"));
  const saved = join(dir, `${title}.sldoc`);
  if (electronMode)
    // The desktop app saves through the system's Save dialog; Sofia saves to her folder.
    await electronApps.get(page)!.evaluate(({ dialog }, folder) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async (
        _window: unknown,
        options: { defaultPath: string },
      ) => ({ canceled: false, filePath: `${folder}/${options.defaultPath}` });
    }, dir);
  const downloaded = electronMode
    ? Promise.resolve(null)
    : page.waitForEvent("download", { timeout: 20 * 60_000 }).catch(() => null);

  await openApp(page);
  await caption(page, "Sofia wants her Lisbon packing list on her work computer too. She asks SuiteLeaf's on-device assistant.");
  const write = await askAgent(
    page,
    `Make a document called ${title}. Put the heading "Lisbon, 3 to 7 November", then a bulleted list: ${items.join(", ")}. Then download it so I can take it to my work computer.`,
  );
  let why = describeRun(write);
  expect(write.state, why).toBe("done");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(page.getByLabel("File title"), why).toHaveValue(title);
  await expect(editor.locator("h1"), why).toHaveText("Lisbon, 3 to 7 November");
  await expect(editor.locator("li"), why).toHaveText(items);
  const download = await downloaded;
  if (electronMode) {
    expect(existsSync(saved), `${why}\nNo file was saved to ${saved}`).toBe(true);
    await expect(page.getByRole("status"), why).toContainText("Saved to file");
  } else {
    expect(download, `${why}\nNothing was downloaded`).not.toBeNull();
    expect(download!.suggestedFilename(), why).toBe(`${title}.sldoc`);
    await download!.saveAs(saved);
    await expect(page.getByRole("status"), why).toHaveText(`Downloaded “${title}.sldoc”`);
  }
  const file = JSON.parse(readFileSync(saved, "utf8"));
  expect(file.title, why).toBe(title);
  for (const text of ["Lisbon, 3 to 7 November", ...items]) expect(JSON.stringify(file.content), why).toContain(text);
  await caption(
    page,
    electronMode
      ? `Gemma wrote the list and saved it as one file, "${title}.sldoc", to carry on a USB stick.`
      : `Gemma wrote the list and downloaded it: one file, "${title}.sldoc", to email or copy to a USB stick.`,
    2600,
  );

  await caption(page, "To be sure that file is all she needs, she has the list removed here.");
  await caption(page, "", 0);
  const remove = await askAgent(page, "Now remove the packing list from SuiteLeaf here. I'll only keep the downloaded file.");
  why = describeRun(remove);
  expect(remove.state, why).toBe("done");
  await expect(page.locator(".file-row"), why).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A workspace waiting for you" }), why).toBeVisible();
  expect(existsSync(saved), why).toBe(true);
  await caption(page, "The library is empty, like a computer that has never seen the list. The file she saved is untouched.", 2200);

  await caption(page, "On the other computer, she asks for the file and one more thing to pack.");
  const reopen = await askAgent(page, "Open the packing list I downloaded and add Sunglasses to the end of the list.", {
    files: [{ name: `${title}.sldoc`, mimeType: "application/json", buffer: readFileSync(saved) }],
  });
  why = describeRun(reopen);
  expect(reopen.state, why).toBe("done");
  await expect(page.getByLabel("File title"), why).toHaveValue(title);
  await expect(editor.locator("h1"), why).toHaveText("Lisbon, 3 to 7 November");
  await expect(editor.locator("li"), why).toHaveText([...items, "Sunglasses"]);
  await expect(editor, why).not.toContainText(/Sunglasses[\s\S]*Sunglasses/);
  // Saving the edit back over the file she carried is fine too.
  await expect(page.getByRole("status"), why).toContainText(electronMode ? /Draft saved|Saved to file/ : "Saved on this device");
  await caption(page, "She picked the file, and it opened whole: the title, the heading and all four items. Sunglasses is fifth.", 2400);

  await page.getByRole("button", { name: "Close assistant" }).click();
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.locator(".file-row")).toHaveCount(1);
  await caption(page, "Later she opens the emailed file again herself, forgetting the list is already here.", 1200);
  if (electronMode) {
    await electronApps.get(page)!.evaluate(({ dialog }, path) => {
      (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, saved);
    await page.getByRole("button", { name: "Open / import" }).click();
  } else {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open / import" }).click();
    await (await chooser).setFiles(saved);
  }
  const same = page.getByRole("dialog", { name: `“${title}” is already ${electronMode ? "on this computer" : "in this browser"}` });
  // If the assistant saved the last edit back over the file, the file matches the list here, so nothing needs asking.
  const lastRequest = reopen.items.slice(reopen.items.map((i) => i.kind).lastIndexOf("user"));
  const savedBack = lastRequest.some((i) => i.kind === "tool" && i.name === "download_file" && i.status === "ok");
  if (savedBack) {
    await page.waitForTimeout(1500);
    if (await same.isVisible()) {
      await expect(same).not.toContainText("The one here has newer changes.");
      await same.getByRole("button", { name: "Cancel" }).click();
    } else if (await page.getByRole("button", { name: "Back to files" }).isVisible()) {
      await page.getByRole("button", { name: "Back to files" }).click();
    }
    await caption(page, "The file she carried already has Sunglasses, so nothing is lost either way.", 2400);
  } else {
    await expect(same).toContainText("The one here has newer changes. Replacing it discards them.");
    await caption(page, "SuiteLeaf sees the list is already here, with newer changes, and asks before replacing it.", 2800);
    await same.getByRole("button", { name: "Cancel" }).click();
  }
  await expect(page.locator(".file-row")).toHaveCount(1);
  await page.getByRole("link", { name: title }).click();
  await expect(editor.locator("li").last()).toHaveText("Sunglasses");
  await caption(page, "She cancels, and her list is as she left it, Sunglasses and all.", 1800);
  await beat(page, 600);
});

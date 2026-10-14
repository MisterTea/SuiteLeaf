import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkbook } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test } from "../harness";

const volunteers: [string, string, number][] = [
  ["Priya Shah", "Kitchen", 14],
  ["Marcus Lee", "Setup", 22],
  ["Alba Reyes", "Kitchen", 9],
  ["Wen Zhou", "Greeters", 31],
  ["Dev Patel", "Setup", 17],
  ["Hana Kim", "Greeters", 12],
  ["Tomás Ruiz", "Kitchen", 26],
  ["Grace Obi", "Setup", 7],
];

test("10-sort-without-the-header-ai", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-10-ai-"));
  if (electronMode)
    // The desktop app saves through the system's Save dialog; Lena saves to her folder.
    await electronApps.get(page)!.evaluate(({ dialog }, folder) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async (
        _window: unknown,
        options: { defaultPath: string },
      ) => ({ canceled: false, filePath: `${folder}/${options.defaultPath}` });
    }, dir);

  await openApp(page);
  await caption(page, "Lena tracks volunteer hours. She wants the busiest volunteers at the top…");
  await openWorkbook(page, "Volunteer hours", [["Name", "Team", "Hours"], ...volunteers]);
  await caption(page, "…but in other apps, sorting dragged the \"Hours\" header down into the list.", 1800);
  await caption(page, "She asks SuiteLeaf's on-device assistant.", 1000);
  await caption(page, "", 0);

  const run = await askAgent(
    page,
    "Put the busiest volunteers at the top, most hours first. Don't move the header row.",
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  await caption(page, "The header stays put, and Wen's 31 hours are on top.", 2000);

  await caption(page, "She keeps a copy of the file to check every row moved together.", 1200);
  let file;
  if (electronMode) {
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved to file");
    file = JSON.parse(readFileSync(join(dir, "Volunteer hours.slsheet"), "utf8"));
  } else {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    file = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  }
  const cells = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]].cellData;
  const row = (r: number) => [0, 1, 2].map((c) => cells[r]?.[c]?.v);
  expect(row(0), why).toEqual(["Name", "Team", "Hours"]);
  const sorted = [...volunteers].sort((a, b) => b[2] - a[2]);
  expect(Array.from({ length: 8 }, (_, r) => row(r + 1)), why).toEqual(sorted);
  expect(row(9), why).toEqual([undefined, undefined, undefined]);
  await caption(page, "In the saved file too: header in row 1, most hours first, every name with its own team and hours.", 2600);
  await beat(page, 600);
});

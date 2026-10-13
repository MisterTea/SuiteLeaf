import type { Download, Page } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Papa from "papaparse";
import { askAgent, beat, caption, describeRun, electronApps, expect, openApp, selectCells, test } from "../harness";

const members = {
  name: "garden-members.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    "Member ID,Name,ZIP,Plot,Dues paid\n00412,Rosa Delgado,02139,A3,45\n00977,Tom Okafor,07302,B1,45\n01205,Mei Chen,10001,B4,0\n00038,Luis Ortega,02139,C2,45\n",
  ),
};

/**
 * Files the app exports: browser downloads on the web; in the desktop app,
 * what its save dialog writes (answered with a folder standing in for Downloads).
 */
async function collectExports(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-16-ai-"));
  const downloads: Download[] = [];
  const app = electronApps.get(page);
  if (app)
    await app.evaluate(({ dialog }, dir) => {
      (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (_window: unknown, options: { defaultPath?: string }) => ({
        canceled: false,
        filePath: `${dir}/${(options.defaultPath ?? "export").split(/[\\/]/).pop()}`,
      });
    }, dir);
  else page.on("download", (d) => downloads.push(d));
  return async () => {
    if (app) return readdirSync(dir).map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
    return Promise.all(downloads.map(async (d) => ({ name: d.suggestedFilename(), text: readFileSync((await d.path())!, "utf8") })));
  };
}

test("16-import-and-export-csv-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Rosa got the community garden's member list as a CSV from the old signup site.");
  await caption(page, "Member IDs like 00412 matter: other spreadsheets often strip the leading zeros. She asks the assistant.", 1800);
  const open = await askAgent(page, "Open the garden members CSV I downloaded from the signup site. Don't lose the leading zeros in the member IDs and ZIP codes.", {
    files: [members],
  });
  let why = describeRun(open);
  expect(open.state, why).toBe("done");
  await expect(page.getByLabel("File title"), why).toHaveValue("garden-members");
  const imported = open.items.find((i) => i.name === "open_from_computer" && i.status !== "error")?.result ?? "";
  expect(imported, why).toMatch(/\n2\t00412\tRosa Delgado\t02139\t/);
  await selectCells(page, "A2");
  await caption(page, "Gemma went through the import preview with code columns kept as text: 00412 is still 00412.", 2400);
  await selectCells(page, "C4");
  await caption(page, "And ZIP 10001 is text like 02139 and 07302.", 1800);

  const exported = await collectExports(page);
  await caption(page, "Mei paid her dues at the work day. Rosa asks for the update and the CSV back.");
  await caption(page, "", 0);
  const update = await askAgent(page, "Mei Chen paid her dues at the work day, so her dues paid is now 45. Then export the list back to CSV.");
  why = `${describeRun(open)}\n--- second request ---\n${describeRun(update)}`;
  expect(update.state, why).toBe("done");

  const files = await exported();
  const csv = files.find((f) => f.name.endsWith(".csv"));
  expect(csv?.name, `${why}\nExported: ${files.map((f) => f.name).join(", ")}`).toBe("garden-members.csv");
  const rows = Papa.parse<string[]>(csv!.text.trim()).data;
  const table = `${why}\n${csv!.text}`;
  expect(rows[0], table).toEqual(["Member ID", "Name", "ZIP", "Plot", "Dues paid"]);
  expect(rows.slice(1).map((r) => r[0]), table).toEqual(["00412", "00977", "01205", "00038"]);
  expect(rows.slice(1).map((r) => r[2]), table).toEqual(["02139", "07302", "10001", "02139"]);
  expect(rows[1], table).toEqual(["00412", "Rosa Delgado", "02139", "A3", "45"]);
  expect(rows[3], table).toEqual(["01205", "Mei Chen", "10001", "B4", "45"]);
  await page.getByRole("button", { name: "Close assistant" }).click();
  await selectCells(page, "E4");
  await caption(page, `The exported file keeps every leading zero. Mei's line now reads: ${csv!.text.split(/\r?\n/)[3]}`, 2800);
  await beat(page, 600);
});

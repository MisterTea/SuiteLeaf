import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, selectCells, test } from "./harness";

const money = { n: { pattern: '"$"#,##0' } };
const months: [string, number][] = [
  ["January", 120],
  ["February", 95],
  ["March", 110],
  ["April", 80],
  ["May", 140],
  ["June", 100],
  ["July", 130],
  ["August", 90],
  ["September", 150],
  ["October", 105],
  ["November", 115],
  ["December", 165],
];

test("58-group-rows", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Omar’s donations sheet has a total and twelve months under it.",
    1600,
  );

  const file = createFile("sheet", "Donations");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "2024";
  const data: [string, number | string, string?][] = [
    ["Total", 1400, "=SUM(B2:B13)"],
    ...months,
  ];
  sheet.cellData = Object.fromEntries(
    data.map((row, index) => [
      index,
      {
        0: {
          v: row[0],
          t: 1,
          ...(index === 0 ? { s: { bl: 1 } } : {}),
        },
        1: row[2]
          ? { f: row[2], v: row[1], t: 2, s: { ...money, bl: 1 } }
          : { v: row[1], t: 2, s: money },
      },
    ]),
  );
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 150 },
    1: { w: 120 },
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "Donations.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await beat(page, 800);
  await caption(page, "Row 1 is the total. Rows 2–13 are the months.", 1800);

  await caption(page, "He selects only the total and chooses Data › Group rows.", 1200);
  await selectCells(page, "A1");
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Group rows", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nothing to group" });
  await expect(dialog).toBeVisible();
  await caption(
    page,
    "There is nothing to group. The total stays on screen, and nothing is hidden.",
    2200,
  );
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("button", { name: /Collapse rows/ })).toHaveCount(0);
  await beat(page, 500);

  await caption(page, "He selects January through December — not the total.", 1400);
  await selectCells(page, "A2:B13");
  await beat(page, 600);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Group rows", exact: true }).click();
  const collapse = page.getByRole("button", { name: "Collapse rows 2 to 13" });
  await expect(collapse).toBeVisible();
  await caption(page, "A minus appears beside the months. The total is not in the group.", 1800);

  await collapse.click();
  const expand = page.getByRole("button", { name: "Expand rows 2 to 13" });
  await expect(expand).toBeVisible();
  await expect(page.locator(".row-group-controls")).toHaveAttribute(
    "data-collapsed",
    "1,2,3,4,5,6,7,8,9,10,11,12",
  );
  await caption(page, "The months are hidden. The total stays on screen.", 900);
  await selectCells(page, "B1");
  await caption(page, "The total is still $1,400, and the formula has not changed.", 2000);

  await expand.click();
  await expect(collapse).toBeVisible();
  await caption(page, "The plus opens every month again.", 1200);
  await selectCells(page, "A2");
  const only = page.getByRole("button", { name: "Show only January" });
  await expect(only).toBeVisible();
  await caption(page, "Someone asks about January. Show only January collapses the rest.", 1500);
  await only.click();
  await expect(page.locator(".row-group-controls")).toHaveAttribute(
    "data-collapsed",
    "2,3,4,5,6,7,8,9,10,11,12",
  );
  await expect(page.getByRole("button", { name: "Expand rows 2 to 13" })).toBeVisible();
  await caption(page, "January stays. February is hidden. The group is still there.", 1800);

  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(page.getByRole("button", { name: /Collapse rows|Expand rows|Show only/ })).toHaveCount(0);
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "");
  await caption(page, "One Undo removes the group. All twelve months are back.", 1800);

  await page.getByRole("button", { name: "Redo (Cmd+Y)" }).click();
  await expect(page.locator(".row-group-controls")).toHaveAttribute(
    "data-collapsed",
    "2,3,4,5,6,7,8,9,10,11,12",
  );
  await caption(page, "Redo puts the group back, still open on January.", 1600);

  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "He leaves Donations and opens it again.", 1200);
  await page.getByRole("link", { name: "Donations" }).click();
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await expect(page.locator(".row-group-controls")).toHaveAttribute(
    "data-collapsed",
    "2,3,4,5,6,7,8,9,10,11,12",
  );
  await expect(page.getByRole("button", { name: "Expand rows 2 to 13" })).toBeVisible();
  await selectCells(page, "B1");
  await caption(page, "January is still the only month on screen. The total is the same.", 2000);
  await beat(page, 600);
});

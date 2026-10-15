import { readFileSync } from "node:fs";
import { openWorkbook } from "../fixtures";
import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const names = [
  "Amina Yusuf", "Priya Shah", "Luis Ortega", "Nora Berg", "Helen Cho",
  "Owen Brooks", "Mei Chen", "Sam Whitfield", "Aiko Tanaka", "Femi Adeyemi",
  "Clara Novak", "Raj Mehta", "Elena Petrova", "Tom Gallagher", "Ida Bergstrom",
  "Jonah Ellis", "Leila Haddad", "Marco Silva", "Nina Kovacs", "Omar Farouk",
  "Paula Niemi", "Quinn Adler", "Rosa Delgado", "Sofia Marin", "Tariq Hassan",
  "Uma Iversen", "Victor Lang", "Willa Grant", "Xavier Boyd", "Yara Nasser",
  "Zoe Kaplan", "Ben Okonkwo", "Carmen Diaz", "David Berg", "Esther Cole",
  "Farah Qureshi", "George Hale", "Hana Suzuki", "Ivan Petrov", "Julia Santos",
];

const status = Array.from({ length: 40 }, (_, i) => {
  if (i === 0) return "Confirmed";
  if ([5, 6, 7, 10].includes(i)) return "yes";
  if ([8, 9].includes(i)) return "tbc";
  if (i === 3) return "Tentative";
  if (i === 1) return "Confirmed ";
  if (i === 2) return "confirmed";
  if (i % 5 === 0) return "Tentative";
  if (i % 7 === 0) return "tentative ";
  return "Confirmed";
});

const shifts = names.map((_, i) => ["Morning", "Afternoon", "Evening"][i % 3]);

/** Final Status after yes/tbc/messy Confirmed become Confirmed, Tentative becomes Maybe, and Priya moves to Waitlist. */
function expectedStatus(i: number) {
  if (names[i] === "Priya Shah") return "Waitlist";
  const text = status[i].trim().toLowerCase();
  if (text === "yes" || text === "tbc" || text === "confirmed") return "Confirmed";
  if (text === "tentative") return "Maybe";
  throw new Error(`Unexpected seed status ${JSON.stringify(status[i])}`);
}

const prompt =
  'Put a dropdown on the Status column that rejects any other value. The choices, in this order, are "Confirmed" (green), "Maybe" (amber), "Can\'t make it" (grey), and "Waitlist" (blue). Change yes and tbc to Confirmed. Tidy Confirmed cells that only differ by spaces or capital letters. Rename Tentative to Maybe. Set Priya Shah\'s status to Waitlist.';

test("37-dropdown-lists-in-a-sheet-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Lena keeps the food bank's volunteer roster. The Status column is a mess of spellings.");
  await openWorkbook(
    page,
    "Volunteer roster",
    [["Name", "Shift", "Status"], ...names.map((name, i) => [name, shifts[i], status[i]])],
    [150, 120, 168],
  );
  await caption(page, "She asks SuiteLeaf's on-device assistant for a dropdown with the committee's real statuses.", 1600);
  await caption(page, "", 0);

  const run = await askAgent(page, prompt);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 400);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  const book = file.content.workbook;
  const sheetId = book.sheetOrder[0];
  const cells = book.sheets[sheetId].cellData;
  const resources = book.resources.find((resource: { name: string }) => resource.name === "SHEET_DATA_VALIDATION_PLUGIN");
  const rules = resources ? (JSON.parse(resources.data)[sheetId] ?? []) : [];
  const rule = rules.find((item: { type?: string }) => item.type === "list");
  const shown = names.map((name, i) => `${name}=${cells[i + 1]?.[2]?.v ?? ""}`).join(", ");
  const detail = `${why}\nRule: ${JSON.stringify(rule)}\nStatus: ${shown}`;

  expect(rule, detail).toBeTruthy();
  expect(JSON.parse(rule.formula1), detail).toEqual(["Confirmed", "Maybe", "Can't make it", "Waitlist"]);
  expect(rule.formula2, detail).toBe("#b7e1cd,#ffe599,#d9d9d9,#c9daf8");
  expect(rule.errorStyle, detail).toBe(1);
  expect(rule.renderMode, detail).toBe(2);
  expect(rule.ranges, detail).toEqual([
    expect.objectContaining({ startRow: 1, endRow: 40, startColumn: 2, endColumn: 2 }),
  ]);

  names.forEach((name, i) => {
    expect(cells[i + 1]?.[0]?.v, detail).toBe(name);
    expect(cells[i + 1]?.[1]?.v, detail).toBe(shifts[i]);
    expect(cells[i + 1]?.[2]?.v, detail).toBe(expectedStatus(i));
  });
  expect(cells[0]?.[2]?.v, detail).toBe("Status");
  await caption(page, "Status is a dropdown: Confirmed, Maybe, Can't make it, and Waitlist. Priya is on the waitlist.", 2000);
});

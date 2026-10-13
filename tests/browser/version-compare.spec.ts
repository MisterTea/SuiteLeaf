import { expect, test } from "@playwright/test";
import { serializeFile } from "@suiteleaf/core";
import { versionWhen } from "../../apps/web/src/editors/version-history-model";
import {
  ROSTER_EARLIER,
  ROSTER_MORNING,
  ROSTER_YESTERDAY,
  deckFile,
  rosterFile,
} from "../compare-fixtures";

function at(daysAgo: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function seedVersions(
  page: import("@playwright/test").Page,
  fileId: string,
  title: string,
  updatedAt: string,
  native: string,
  versions: { id: string; createdAt: string; native: string }[],
) {
  await page.evaluate(
    async ({ fileId, title, updatedAt, native, versions }) => {
      const open = (name: string, version?: number, setup?: (db: IDBDatabase) => void) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
          if (setup) request.onupgradeneeded = () => setup(request.result);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const put = (db: IDBDatabase, store: string, value: unknown) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(value);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      // Dexie stores schema version × 10, so the library the app just opened is version 30.
      const library = await open("SuiteLeaf");
      await put(library, "encoded", { id: fileId, title, updatedAt, native });
      library.close();
      const history = await open("SuiteLeafVersions", 10, (db) => {
        if (!db.objectStoreNames.contains("versions")) {
          const store = db.createObjectStore("versions", { keyPath: "id" });
          store.createIndex("fileId", "fileId");
          store.createIndex("createdAt", "createdAt");
        }
      });
      for (const version of versions) {
        await put(history, "versions", {
          id: version.id,
          fileId,
          createdAt: version.createdAt,
          authorId: "local",
          authorName: "You",
          name: null,
          restoredFrom: null,
          native: version.native,
        });
      }
      history.close();
    },
    { fileId, title, updatedAt, native, versions },
  );
}

test("a local spreadsheet version compares cells, including format, and stays read-only", async ({
  page,
}) => {
  const id = "local-roster";
  const earlierAt = at(2, 16, 40);
  const yesterdayAt = at(1, 18, 5);
  const morningAt = at(0, 9, 12);
  const earlier = serializeFile(rosterFile(id, earlierAt, ROSTER_EARLIER, false));
  const yesterday = serializeFile(rosterFile(id, yesterdayAt, ROSTER_YESTERDAY, false));
  const morning = serializeFile(rosterFile(id, morningAt, ROSTER_MORNING, true));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New spreadsheet" })).toBeVisible();
  await seedVersions(page, id, "Volunteer roster", morningAt, morning, [
    { id: "roster-morning", createdAt: morningAt, native: morning },
    { id: "roster-yesterday", createdAt: yesterdayAt, native: yesterday },
    { id: "roster-earlier", createdAt: earlierAt, native: earlier },
  ]);
  await page.goto(`/#/file/${id}`);
  await expect(page.getByRole("button", { name: "Sheet tools", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Version history" });
  await panel.getByRole("button", { name: `${versionWhen(yesterdayAt)} · You`, exact: true }).click();
  const preview = page.locator(".sheet-version-preview");
  await expect(panel.getByText("8 cells change", { exact: true })).toBeVisible();
  await expect(preview.locator("s").filter({ hasText: "Maybe" }).first()).toBeVisible();
  await expect(preview.locator("u").filter({ hasText: "Waitlist" })).toBeVisible();
  await expect(preview.locator(".sheet-compare-badge", { hasText: "Bold" }).first()).toBeVisible();
  await expect(preview.locator('[data-change="same"]', { hasText: "Noah" })).toBeVisible();
  await expect(preview.locator('[data-row="7"][data-col="1"]')).toHaveAttribute("data-change", "same");

  await preview.click();
  await page.keyboard.type("SHOULD NOT LAND");
  await page.keyboard.insertText("SHOULD NOT LAND");
  await expect(preview).not.toContainText("SHOULD NOT LAND");

  await panel.getByRole("button", { name: "Changes in this version" }).click();
  await expect(panel.getByText("6 cells change in this version", { exact: true })).toBeVisible();
  await expect(preview.locator("s").filter({ hasText: "Invited" }).first()).toBeVisible();
  await expect(preview.locator(".sheet-compare-badge", { hasText: "Bold" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Compare with current" }).click();
  await expect(panel.getByText("8 cells change", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByText("8 cells change", { exact: true })).toBeVisible();
  await expect(preview.locator("u").filter({ hasText: "Waitlist" })).toBeVisible();
});

test("a local slide version shows added and removed text and a deleted slide", async ({
  page,
}) => {
  const id = "local-deck";
  const yesterdayAt = at(1, 19, 20);
  const morningAt = at(0, 10, 4);
  const older = serializeFile(deckFile(id, yesterdayAt, "Fundraiser pitch", true));
  const current = serializeFile(deckFile(id, morningAt, "Spring fair", false));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New presentation" })).toBeVisible();
  await seedVersions(page, id, "Fundraiser pitch", morningAt, current, [
    { id: "deck-morning", createdAt: morningAt, native: current },
    { id: "deck-yesterday", createdAt: yesterdayAt, native: older },
  ]);
  await page.goto(`/#/file/${id}`);
  await expect(page.locator(".slide-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Version history" });
  await panel.getByRole("button", { name: `${versionWhen(yesterdayAt)} · You`, exact: true }).click();
  const preview = page.locator(".slide-version-preview");
  await expect(panel.getByText("2 slides change", { exact: true })).toBeVisible();
  await expect(preview.locator("s").filter({ hasText: "Fundraiser pitch" })).toBeVisible();
  await expect(preview.locator("u").filter({ hasText: "Spring fair" })).toBeVisible();
  await preview.getByRole("button", { name: "Thank you, deleted slide" }).click();
  await expect(preview.locator(".slide-compare-flag")).toHaveText("Deleted");
  await expect(preview.locator("s").filter({ hasText: "Thank you" })).toBeVisible();
  await preview.click();
  await page.keyboard.type("SHOULD NOT LAND");
  await expect(preview).not.toContainText("SHOULD NOT LAND");
  await page.getByRole("button", { name: "Close version history" }).click();
  await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Spring fair");
  await expect(page.locator(".thumbnail-row")).toHaveCount(2);
});

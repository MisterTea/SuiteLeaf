import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
  type SheetFile,
} from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { authed, showDrive, signIn, signup } from "./cluster-drive";
import {
  beat,
  caption,
  clusterReady,
  expect,
  startServer,
  test,
  typeSlowly,
} from "./harness";

/** Keep the caption above the tab row so the page and the letters stay visible. */
async function say(page: Page, text: string, hold = 1500) {
  await caption(page, text, 0);
  await page.evaluate(() => {
    const bar = document.getElementById(
      "storyboard-caption",
    ) as HTMLElement | null;
    const tabs = document.querySelector(".doc-tab-bar");
    if (!bar) return;
    bar.style.top = "auto";
    bar.style.bottom = tabs
      ? `${window.innerHeight - tabs.getBoundingClientRect().top + 12}px`
      : "28px";
  });
  await beat(page, hold);
}

function roster(): SheetFile {
  const file = createFile("sheet", "Garden members") as SheetFile;
  const id = file.content.workbook.sheetOrder[0];
  file.content.workbook.sheets[id].cellData = {
    "0": { "0": { v: "Name" }, "1": { v: "Plot" } },
    "1": { "0": { v: "Rosa" }, "1": { v: "Sunny" } },
    "2": { "0": { v: "Leo" }, "1": { v: "Shade" } },
  };
  return file;
}

async function libraryRows(page: Page) {
  return page.evaluate(async () => {
    const rows = await new Promise<{ title: string; drive?: unknown }[]>(
      (resolve, reject) => {
        const open = indexedDB.open("SuiteLeaf");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("encoded")) {
            resolve([]);
            return;
          }
          const request = db
            .transaction("encoded", "readonly")
            .objectStore("encoded")
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        };
      },
    );
    return rows.map((row) => ({ title: row.title, drive: Boolean(row.drive) }));
  });
}

async function seedLocalSheet(page: Page) {
  const file = createFile("sheet", "Plot notes");
  await page.evaluate(
    async (record) => {
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
    },
    {
      id: file.id,
      title: file.title,
      updatedAt: file.updatedAt,
      native: serializeFile(file),
    },
  );
}

test("150-use-the-roster-on-the-server", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    const club = await (
      await authed(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({ name: "Garden club", kind: "folder" }),
      })
    ).json();
    const file = roster();
    const item = await (
      await authed(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          mime: mimeFor("sheet"),
          parentId: club.id,
        }),
      })
    ).json();
    await authed(
      server.url,
      rosa.token,
      `/api/drive/items/${item.id}/content`,
      {
        method: "PUT",
        headers: { "content-type": mimeFor("sheet") },
        body: serializeFile(file),
      },
    );

    const rootNames = async () => {
      const listed = (await (
        await authed(server.url, rosa.token, "/api/drive/items")
      ).json()) as { items: { name: string }[] };
      return listed.items.map((entry) => entry.name).sort();
    };

    await page.goto(server.url);
    await caption(
      page,
      "Rosa signs in. Garden members is in Garden club on the server. She has never opened it on this computer.",
    );
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    await expect(
      page.getByRole("button", { name: "Garden club", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Garden members.slsheet" }),
    ).toHaveCount(0);
    await beat(page, 900);

    await caption(
      page,
      "She writes Plot letter: Hello {{Name}}, your plot is {{Plot}}.",
    );
    await page.getByRole("button", { name: "New document" }).click();
    const title = page.getByLabel("File title");
    await expect(title).toBeVisible();
    await title.click();
    await title.press("ControlOrMeta+A");
    await typeSlowly(page, "Plot letter");
    const body = page.getByRole("textbox", { name: "Document content" });
    await body.click();
    await typeSlowly(page, "Hello {{Name}}, your plot is {{Plot}}.");
    await expect(body).toContainText("Hello {{Name}}, your plot is {{Plot}}.");
    await expect(page.locator(".save-status")).toHaveText(
      "Saved to SuiteDrive",
      { timeout: 20000 },
    );
    await say(page, "The letter says Hello {{Name}}, your plot is {{Plot}}.");

    await seedLocalSheet(page);
    const stored = await libraryRows(page);
    expect(stored.map((row) => row.title)).not.toContain("Garden members");
    expect(stored).toContainEqual({ title: "Plot notes", drive: false });

    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await beat(page, 600);
    await page
      .getByRole("menuitem", { name: "Merge from a spreadsheet" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Merge from a spreadsheet",
    });
    await expect(dialog).toContainText("Nothing is emailed");
    await expect(dialog).toContainText("Garden members");
    await expect(dialog).toContainText("Garden club");
    await expect(dialog).toContainText("Plot notes");
    await expect(dialog).toContainText("On this computer");
    const rosterRadio = dialog.getByRole("radio", { name: "Garden members" });
    const localRadio = dialog.getByRole("radio", { name: "Plot notes" });
    await expect(rosterRadio).toBeVisible();
    await expect(localRadio).toBeVisible();
    await say(
      page,
      "Garden members is in Garden club. Plot notes is only on this computer. Nothing is emailed.",
      1800,
    );
    await rosterRadio.click();
    await beat(page, 700);
    await dialog.getByRole("button", { name: "Merge", exact: true }).click();

    await expect(title).toHaveValue("Plot letter merged");
    await expect(body).toContainText("Hello Rosa, your plot is Sunny.");
    await expect(body).toContainText("Hello Leo, your plot is Shade.");
    await expect(page.locator(".manual-page-break")).toHaveCount(1);
    await expect(page.locator(".editor-status")).toContainText("2 pages");
    const order = await page
      .locator(".document-content")
      .evaluate((root) =>
        [...root.querySelectorAll("p, .manual-page-break")].map((el) =>
          el.classList.contains("manual-page-break")
            ? "break"
            : (el.textContent ?? ""),
        ),
      );
    const rosaAt = order.findIndex((line) => line.includes("Hello Rosa"));
    const gap = order.indexOf("break");
    const leo = order.findIndex((line) => line.includes("Hello Leo"));
    expect(rosaAt).toBeGreaterThanOrEqual(0);
    expect(gap).toBeGreaterThan(rosaAt);
    expect(leo).toBeGreaterThan(gap);

    await page
      .getByText("Hello Rosa, your plot is Sunny.")
      .scrollIntoViewIfNeeded();
    await say(page, "Hello Rosa, your plot is Sunny.", 1600);
    await page
      .getByText("Hello Leo, your plot is Shade.")
      .scrollIntoViewIfNeeded();
    await say(
      page,
      "Hello Leo, your plot is Shade. His letter starts on the next page.",
      1800,
    );

    await expect.poll(rootNames).toContain("Plot letter merged.sldoc");
    const before = await rootNames();
    expect(before.filter((name) => name.includes("merged"))).toEqual([
      "Plot letter merged.sldoc",
    ]);
    expect(before).not.toContain("Garden members.slsheet");

    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await expect(
      page.getByRole("button", { name: "Plot letter.sldoc", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Plot letter merged.sldoc",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Garden members.slsheet" }),
    ).toHaveCount(0);
    await caption(
      page,
      "The letters are a new document. Garden members stayed in Garden club. Nothing was emailed.",
      1800,
    );

    await page
      .getByRole("button", { name: "Plot letter.sldoc", exact: true })
      .click();
    await expect(body).toContainText("Hello {{Name}}, your plot is {{Plot}}.");
    await say(
      page,
      "The original letter still says {{Name}} and {{Plot}}.",
      1400,
    );
    await page.getByText("Hello {{Name}}, your plot is {{Plot}}.").click();
    await page.keyboard.press("ControlOrMeta+A");
    await typeSlowly(page, "Hello {{Bed}}, your plot is {{Plot}}.");
    await expect(body).toContainText("Hello {{Bed}}, your plot is {{Plot}}.");
    await expect(body).not.toContainText("{{Name}}");
    await say(
      page,
      "She changes the placeholder to {{Bed}}. The sheet has no Bed column.",
      1500,
    );

    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await beat(page, 500);
    await page
      .getByRole("menuitem", { name: "Merge from a spreadsheet" })
      .click();
    await dialog.getByRole("radio", { name: "Garden members" }).click();
    await beat(page, 500);
    const namesBeforeBed = await rootNames();
    await dialog.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Bed is not a column.");
    await expect(title).toHaveValue("Plot letter");
    await say(page, "Bed is not a column. No new letter is created.", 2200);
    expect(await rootNames()).toEqual(namesBeforeBed);
    expect(
      (await libraryRows(page)).filter((row) => row.title.includes("merged")),
    ).toHaveLength(1);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await expect(
      page.getByRole("button", {
        name: "Plot letter merged.sldoc",
        exact: true,
      }),
    ).toHaveCount(1);
    await caption(
      page,
      "My Drive still has one merged document. Nothing was emailed.",
      2200,
    );
  } finally {
    server.stop();
  }
});

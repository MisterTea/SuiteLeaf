import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
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
} from "./harness";

async function fileMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("141-start-the-next-rota-in-the-same-folder", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    const club = await (
      await authed(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({ name: "Garden club", kind: "folder" }),
      })
    ).json();
    const file = createFile("doc", "Watering rota");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Thursday: Rosa waters the beds." }],
        },
      ],
    };
    const item = await (
      await authed(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          mime: mimeFor("doc"),
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
        headers: { "content-type": mimeFor("doc") },
        body: serializeFile(file),
      },
    );

    await page.goto(server.url);
    await caption(
      page,
      "Rosa signs in and opens Garden club, where the watering rota lives.",
    );
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    const rota = page.getByRole("button", {
      name: "Watering rota.sldoc",
      exact: true,
    });
    const copy = page.getByRole("button", {
      name: "Watering rota copy.sldoc",
      exact: true,
    });
    const note = page.getByRole("button", {
      name: "Untitled document.sldoc",
      exact: true,
    });
    const inClub = page.getByRole("button", { name: "Folder Garden club" });
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await expect(page.getByLabel("Folder path")).toContainText("Garden club");
    await expect(rota).toBeVisible();
    await expect(copy).toHaveCount(0);
    await beat(page, 800);

    await caption(
      page,
      "She opens the rota. Next to the title, it says Garden club.",
      700,
    );
    await rota.click();
    await expect(inClub).toBeVisible();
    await beat(page, 900);

    await caption(
      page,
      "File › Make a copy. No folder dialog. The copy stays in Garden club.",
      700,
    );
    await fileMenu(page, "Make a copy");
    await expect(page.getByLabel("File title")).toHaveValue("Watering rota copy");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(inClub).toBeVisible();
    expect(dialogs).toEqual([]);
    await beat(page, 900);

    await caption(
      page,
      "Garden club lists the rota and the copy. My Drive lists neither.",
      700,
    );
    await inClub.click();
    await showDrive(page);
    await expect(page.getByLabel("Folder path")).toContainText("Garden club");
    await expect(rota).toBeVisible();
    await expect(copy).toBeVisible();
    await beat(page, 900);
    await page.getByRole("tab", { name: "My Drive" }).click();
    await expect(rota).toHaveCount(0);
    await expect(copy).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Garden club", exact: true }),
    ).toBeVisible();
    await beat(page, 800);

    await caption(
      page,
      "She opens the copy and chooses File › New › Document. It lands in Garden club too.",
      700,
    );
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(inClub).toBeVisible();
    await beat(page, 700);
    await page.getByRole("button", { name: "File", exact: true }).click();
    await beat(page, 400);
    await page.getByRole("menuitem", { name: "New", exact: true }).hover();
    await beat(page, 500);
    await page.getByRole("menuitem", { name: "Document", exact: true }).click();
    await expect(page.getByLabel("File title")).toHaveValue("Untitled document");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(inClub).toBeVisible();
    await beat(page, 900);
    await inClub.click();
    await showDrive(page);
    await expect(page.getByLabel("Folder path")).toContainText("Garden club");
    await expect(rota).toBeVisible();
    await expect(copy).toBeVisible();
    await expect(note).toBeVisible();
    expect(dialogs).toEqual([]);
    await beat(page, 1600);
  } finally {
    server.stop();
  }
});

import type { Locator, Page } from "@playwright/test";
import { mimeFor } from "@suiteleaf/core";
import { authed, signIn, signup } from "./cluster-drive";
import {
  beat,
  caption,
  clusterReady,
  expect,
  startServer,
  test,
  typeSlowly,
} from "./harness";

/** Put the caret after the last character of a document and type there. */
async function typeAtEnd(page: Page, editor: Locator, text: string) {
  const line = (await editor.locator("p").last().boundingBox())!;
  await page.mouse.click(line.x + line.width - 4, line.y + line.height / 2);
  await typeSlowly(page, text);
}

test("143-hear-that-jordan-saved", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  try {
    const sam = await signup(
      server.url,
      "Sam Okafor",
      "sam@riverside-garden.org",
    );
    const jordan = await signup(
      server.url,
      "Jordan",
      "jordan@riverside-garden.org",
    );

    await page.goto(server.url);
    await caption(
      page,
      "Sam signs in and opens the bake sale flyer. He is reading it, not typing.",
    );
    await signIn(page, "sam@riverside-garden.org");
    await page.getByRole("button", { name: "New document" }).click();
    const title = page.getByLabel("File title");
    await title.click();
    await title.press("ControlOrMeta+A");
    await typeSlowly(page, "Bake sale flyer");
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.click();
    await typeSlowly(page, "Bake sale on Saturday, 10 am to noon.");
    const status = page.locator(".save-status");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
    await caption(
      page,
      "The flyer is saved to SuiteDrive. Sam leaves it on screen.",
      2000,
    );

    /** Save a new version the way Jordan's computer would. */
    const saveAsJordan = async (from: string, to: string) => {
      const listed = (await (
        await authed(server.url, sam.token, "/api/drive/items")
      ).json()) as { items: { id: string; name: string }[] };
      const item = listed.items.find(
        (entry) => entry.name === "Bake sale flyer.sldoc",
      );
      if (!item) throw new Error("Bake sale flyer is not in SuiteDrive yet.");
      await authed(server.url, sam.token, `/api/drive/items/${item.id}/acl`, {
        method: "PUT",
        body: JSON.stringify({
          principalType: "user",
          principalId: jordan.user.id,
          role: "editor",
        }),
      });
      const path = `/api/drive/items/${item.id}/content`;
      const text = await (await authed(server.url, jordan.token, path)).text();
      const body = text.replace(from, to).replaceAll("Bring a cake!", "");
      if (body.includes("Bring a cake!"))
        throw new Error("Jordan's version still contains Sam's unsent line.");
      await authed(server.url, jordan.token, path, {
        method: "PUT",
        headers: { "content-type": mimeFor("doc") },
        body,
      });
    };

    await caption(
      page,
      "Jordan, on another computer, changes the time to 9 am to 1 pm and saves.",
      1800,
    );
    await saveAsJordan("10 am to noon", "9 am to 1 pm");
    await expect(editor).toContainText("9 am to 1 pm", { timeout: 8000 });
    await expect(editor).not.toContainText("10 am to noon");
    await expect(status).toHaveText("Jordan updated this.");
    await caption(
      page,
      "The page catches up on its own. The status says Jordan updated this. Sam did not click Reload.",
      3600,
    );

    await caption(
      page,
      "Sam starts a line, Bring a cake!, and does not wait for it to save.",
      800,
    );
    await typeAtEnd(page, editor, " Bring a cake!");
    await expect(editor).toContainText("Bring a cake!");
    await saveAsJordan("Saturday", "Saturday 14 June");
    const banner = page.getByText(
      "This file was changed in SuiteDrive after you opened it",
    );
    await expect(banner).toBeVisible({ timeout: 8000 });
    await expect(editor).toContainText("Bring a cake!");
    await expect(editor).toContainText("9 am to 1 pm");
    await caption(
      page,
      "Jordan saved Saturday 14 June. The banner appears, and Bring a cake! is still in the document.",
      3600,
    );

    await caption(page, "Sam keeps his version as a copy.", 1200);
    await page.getByRole("button", { name: "Save as copy" }).click();
    await expect(banner).toHaveCount(0);
    await expect(editor).toContainText("Bring a cake!");
    await expect(status).toHaveText("Saved a copy to SuiteDrive", {
      timeout: 20000,
    });
    await beat(page, 600);
    await caption(
      page,
      "The cake line stays, and the status no longer says a newer version is waiting.",
      3200,
    );
  } finally {
    server.stop();
  }
});

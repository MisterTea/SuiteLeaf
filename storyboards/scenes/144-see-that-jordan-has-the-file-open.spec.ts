import { authed, signIn, signup } from "./cluster-drive";
import { caption, clusterReady, expect, startServer, test, typeSlowly } from "./harness";

test("144-see-that-jordan-has-the-file-open", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  let stopJordan: (() => Promise<void>) | undefined;
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
        role: "viewer",
      }),
    });

    const here = page.getByRole("region", { name: "Also in this file" });
    await expect(page.locator(".presence-chip")).toHaveCount(0);
    await expect(page.getByText(/is viewing|is editing/)).toHaveCount(0);
    await caption(
      page,
      "Sam is alone. Next to the title there is no one else's name.",
      2400,
    );

    await caption(
      page,
      "Jordan opens the same flyer on another computer and does not type.",
      1200,
    );
    let editing = false;
    let live = true;
    let chain = Promise.resolve();
    const post = () => {
      const flag = editing;
      const run = chain.catch(() => {}).then(async () => {
        if (!live) return;
        await authed(
          server.url,
          jordan.token,
          `/api/drive/items/${item.id}/presence`,
          {
            method: "POST",
            body: JSON.stringify({ editing: flag }),
          },
        );
      });
      chain = run;
      return run;
    };
    const timer = setInterval(() => {
      void post().catch(() => {});
    }, 3000);
    stopJordan = async () => {
      live = false;
      clearInterval(timer);
      await chain.catch(() => {});
    };
    await post();
    await expect(here).toContainText("Jordan is viewing", { timeout: 8000 });
    await expect(editor).toContainText("Bake sale on Saturday, 10 am to noon.");
    await expect(editor).not.toContainText("Jordan");
    await caption(
      page,
      "A chip beside the title says Jordan is viewing. Nothing is drawn on the sentence.",
      3200,
    );

    await caption(
      page,
      "Jordan's side marks the flyer as being edited. The sentence should stay readable.",
      800,
    );
    editing = true;
    await post();
    await expect(here).toContainText("Jordan is editing", { timeout: 8000 });
    await expect(here).not.toContainText("is viewing");
    await expect(editor).toContainText("Bake sale on Saturday, 10 am to noon.");
    await expect(editor).not.toContainText("Jordan");
    const chipBox = await here.boundingBox();
    const editorBox = await editor.boundingBox();
    expect(chipBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(editorBox!.y + 2);
    await caption(
      page,
      "The chip says Jordan is editing. It stays in the header, and the time is still fully readable.",
      3400,
    );

    await stopJordan();
    stopJordan = undefined;
    await caption(page, "Jordan closes the flyer.", 1000);
    await expect(page.locator(".presence-chip")).toHaveCount(0, {
      timeout: 26000,
    });
    await expect(editor).toContainText("Bake sale on Saturday, 10 am to noon.");
    await expect(editor).not.toContainText("Jordan");
    await caption(
      page,
      "The chip is gone. Sam did not save, and the sentence is unchanged.",
      3200,
    );
  } finally {
    await stopJordan?.();
    server.stop();
  }
});

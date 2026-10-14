import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
} from "@suiteleaf/core";
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

test("142-find-the-rota-by-what-it-says", async ({ page }) => {
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
    const file = createFile("doc", "Watering rota");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Thursday: ask Alex to cover." },
          ],
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
      "Rosa signs in. My Drive shows Garden club, and the watering rota is not in the list.",
    );
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    await expect(
      page.getByRole("button", { name: "Garden club", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Watering rota.sldoc", exact: true }),
    ).toHaveCount(0);
    await beat(page, 800);

    await caption(
      page,
      "She types Thursday in Search SuiteDrive. She does not open the folder.",
    );
    const search = page.getByLabel("Search SuiteDrive");
    await search.click();
    await typeSlowly(page, "Thursday");
    const result = page.getByRole("button", { name: /Watering rota/ });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Garden club");
    await expect(result).toContainText("Thursday");
    await beat(page, 1200);

    await caption(
      page,
      "The result shows the rota, the folder, and the matching words. She opens it.",
    );
    await result.click();
    await expect(
      page.getByRole("textbox", { name: "Document content" }),
    ).toContainText("Thursday: ask Alex to cover.");
    await beat(page, 1200);

    await caption(
      page,
      "A search for zucchini says that no files match.",
    );
    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await search.click();
    await typeSlowly(page, "zucchini");
    await expect(page.getByText("No files match.", { exact: true })).toBeVisible();
    await expect(page.getByText("This folder is empty.")).toHaveCount(0);
    await beat(page, 1600);
  } finally {
    server.stop();
  }
});

import { test, expect } from "@playwright/test";

test("single-node mode keeps files in the browser without accounts", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Your workspace, in this browser."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "SuiteDrive" })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Connect to a server" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Connect to a SuiteLeaf server",
  });
  await dialog.getByLabel("Server address").fill("http://127.0.0.1:9");
  await dialog.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "No SuiteLeaf server answered at that address.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "New document" }).click();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Download SuiteLeaf file" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /SuiteDrive|Open…/ }),
  ).toHaveCount(0);
});

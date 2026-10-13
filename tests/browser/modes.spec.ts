import { test, expect, type Page } from "@playwright/test";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/** Answer for a SuiteLeaf server at `origin` without running one. */
async function fakeServer(page: Page, origin: string) {
  await page.route(`${origin}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const body =
      pathname === "/api/node/info"
        ? {
            name: "SuiteLeaf node",
            mode: "cluster",
            auth: { enabled: true },
          }
        : pathname === "/api/auth/suiteleaf/providers"
          ? { emailAndPassword: true, username: true, providers: [] }
          : pathname === "/api/drive/items"
            ? { items: [] }
            : null;
    return body
      ? route.fulfill({ headers: cors, json: body })
      : route.fulfill({ status: 404, headers: cors, json: {} });
  });
}

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

test("connecting accepts a server address without http:// or https://", async ({
  page,
}) => {
  // WebKit does not reliably intercept fetches to these hosts, so answer here.
  await page.addInitScript(() => {
    const info = JSON.stringify({
      name: "SuiteLeaf node",
      mode: "cluster",
      auth: { enabled: true },
    });
    const orig = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = String(input);
      if (url.includes("://team.example.org/api/node/info"))
        return Promise.resolve(
          new Response(info, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      if (url.startsWith("https://lan-box.test/"))
        return Promise.resolve(new Response("", { status: 502 }));
      if (url.startsWith("http://lan-box.test/api/node/info"))
        return Promise.resolve(
          new Response(info, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      return orig(input, init);
    };
  });
  await page.goto("/");

  const connect = async (address: string) => {
    await page.getByRole("button", { name: "Connect to a server" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Connect to a SuiteLeaf server",
    });
    await dialog.getByLabel("Server address").fill(address);
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();
    const card = page.getByLabel("Sign in to SuiteLeaf");
    await expect(card).toBeVisible();
    return card;
  };
  const savedServer = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("suiteleaf:mode")!).serverUrl,
    );

  await expect(await connect("team.example.org/")).toContainText(
    "team.example.org",
  );
  expect(await savedServer()).toBe("https://team.example.org");

  await page
    .getByRole("button", { name: "Work on this computer without a server" })
    .click();
  await expect(await connect("lan-box.test")).toContainText("lan-box.test");
  expect(await savedServer()).toBe("http://lan-box.test");
});

test("the account chip shows the whole name next to Sign out and Disconnect", async ({
  page,
}) => {
  await fakeServer(page, "https://team.example.org");
  await page.addInitScript(() => {
    localStorage.setItem(
      "suiteleaf:mode",
      JSON.stringify({
        kind: "cluster",
        serverUrl: "https://team.example.org",
      }),
    );
    localStorage.setItem(
      "suiteleaf:node-session",
      JSON.stringify({
        url: "https://team.example.org",
        token: "test-token",
        user: { id: "u1", name: "Leo Martins", email: "leo@example.org" },
      }),
    );
  });
  await page.goto("/");
  const chip = page.locator(".account-chip");
  await expect(chip).toContainText("Leo Martins");
  await expect(chip).toContainText("team.example.org");
  await expect(chip.getByRole("button", { name: "Sign out" })).toHaveText(
    "Sign out",
  );
  await expect(
    chip.getByRole("button", { name: "Disconnect from server" }),
  ).toHaveText("Disconnect");
  const truncated = await chip
    .locator(".account-name")
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(truncated).toBe(false);
});

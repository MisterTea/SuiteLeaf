import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
} from "@suiteleaf/core";
import {
  beat,
  caption,
  clusterReady,
  expect,
  startServer,
  test,
  typeSlowly,
} from "./harness";

test("138-hand-someone-the-sign-up-link", async ({ page }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  const server = await startServer();
  try {
    const password = "garden-club";
    const signup = await fetch(`${server.url}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.url },
      body: JSON.stringify({
        name: "Rosa Diaz",
        email: "rosa@gardenclub.org",
        password,
      }),
    });
    if (!signup.ok)
      throw new Error(`Could not create Rosa: ${signup.status} ${await signup.text()}`);
    const rosa = await signup.json();
    const file = createFile("form", "Plot sign-ups");
    if (file.kind !== "form") throw new Error("Expected a form.");
    file.content = {
      questions: [
        { id: "name", prompt: "Your name", kind: "text", required: true },
        {
          id: "plot",
          prompt: "Plot size",
          kind: "choice",
          required: true,
          choices: ["Small", "Medium", "Large"],
        },
        { id: "notes", prompt: "Notes", kind: "text", required: false },
      ],
      responses: [],
    };
    const authed = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${rosa.token}`);
      if (init.body && !headers.has("content-type"))
        headers.set("content-type", "application/json");
      const response = await fetch(`${server.url}${path}`, { ...init, headers });
      if (!response.ok)
        throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
      return response;
    };
    const item = await (
      await authed("/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          mime: mimeFor("form"),
        }),
      })
    ).json();
    await authed(`/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("form") },
      body: serializeFile(file),
    });

    await page.addInitScript(
      (session) => localStorage.setItem("suiteleaf:node-session", JSON.stringify(session)),
      { url: server.url, token: rosa.token, user: rosa.user },
    );
    await page.goto(server.url);
    await caption(page, "Rosa opens the plot sign-up. The questions are already here.");
    await page
      .getByRole("heading", { name: "SuiteDrive" })
      .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await beat(page, 700);
    await page.getByRole("button", { name: "Plot sign-ups.slform", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Questions" })).toBeVisible();
    const prompts = page.getByRole("textbox", { name: "Question", exact: true });
    await expect(prompts.nth(0)).toHaveValue("Your name");
    await expect(prompts.nth(1)).toHaveValue("Plot size");
    await expect(prompts.nth(2)).toHaveValue("Notes");
    await beat(page, 800);

    await caption(page, "She opens Sign-up link. It only adds a response.", 900);
    await page.getByRole("button", { name: "Sign-up link", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Sign-up link" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("This link only adds a response.");
    await expect(dialog).toContainText("It does not show other people's answers");
    await expect(dialog).toContainText("it does not change the questions.");
    const link = dialog.getByLabel("Sign-up link");
    await expect(link).toHaveValue(/\/sign-up\/[0-9a-f-]{36}$/i);
    const url = await link.inputValue();
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await caption(page, "The address is on the page. She copies it.", 1600);

    await page.goto(url);
    await caption(
      page,
      "A neighbor opens it. No sign-in, no editor, and no other answers.",
      800,
    );
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Questions" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Responses" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Large" })).toBeVisible();
    await expect(page.getByLabel("Notes")).toBeVisible();
    await page.getByLabel("Your name").click();
    await typeSlowly(page, "Alex");
    await page.getByRole("radio", { name: "Large" }).check();
    await caption(page, "Alex, Large, and no notes.", 1200);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByText("Your sign-up was received.")).toBeVisible();
    await caption(page, "The page says the sign-up was received.", 1400);

    await page.goto(server.url);
    await caption(page, "Rosa goes back to the form.", 700);
    await page
      .getByRole("heading", { name: "SuiteDrive" })
      .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await beat(page, 500);
    await page.getByRole("button", { name: "Plot sign-ups.slform", exact: true }).click();
    await page.getByRole("tab", { name: "Responses" }).click();
    const table = page.locator(".form-responses table");
    await expect(table).toContainText("Alex");
    await expect(table).toContainText("Large");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await caption(page, "Alex and Large are in this file.", 1200);
    await page.getByRole("tab", { name: "Questions" }).click();
    await expect(prompts.nth(0)).toHaveValue("Your name");
    await expect(prompts.nth(1)).toHaveValue("Plot size");
    await expect(prompts.nth(2)).toHaveValue("Notes");
    await beat(page, 800);

    await caption(page, "She turns the link off.", 800);
    await page.getByRole("button", { name: "Sign-up link", exact: true }).click();
    const again = page.getByRole("dialog", { name: "Sign-up link" });
    await expect(again.getByLabel("Sign-up link")).toHaveValue(url);
    await again.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(again).toHaveCount(0);
    await beat(page, 600);

    await page.goto(url);
    await expect(page.getByText("This sign-up is closed.")).toBeVisible();
    await caption(page, "The same address now says the sign-up is closed.", 1600);

    await page.goto(server.url);
    await page
      .getByRole("heading", { name: "SuiteDrive" })
      .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await beat(page, 400);
    await page.getByRole("button", { name: "Plot sign-ups.slform", exact: true }).click();
    await page.getByRole("tab", { name: "Responses" }).click();
    await expect(page.locator(".form-responses table")).toContainText("Alex");
    await expect(page.locator(".form-responses table tbody tr")).toHaveCount(1);
    await caption(page, "Alex's row is still in the form.", 1600);
  } finally {
    server.stop();
  }
});

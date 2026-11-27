import { beat, caption, expect, test, typeSlowly } from "./harness";

test("157-android-companion-settings", async ({ page }, info) => {
  test.skip(
    info.project.name !== "android-app",
    "Runs inside the real Capacitor Android APK (android-app engine).",
  );

  await page.goto("/");
  await beat(page, 800);

  await caption(
    page,
    "SuiteLeaf Android launches in single-node companion mode, ready for Google Drive sync.",
    1800,
  );
  await expect(page.getByRole("button", { name: "Connect Google Drive" })).toBeVisible();
  await beat(page, 600);

  await caption(
    page,
    "Open Settings to inspect Google Drive Sync (My Drive/SuiteLeaf).",
    1600,
  );
  const settingsBtn = page.getByRole("button", { name: "Settings" });
  if (!(await settingsBtn.isVisible().catch(() => false))) {
    const menuBtn = page.getByRole("button", { name: /menu|sidebar|navigation/i }).first();
    if (await menuBtn.isVisible().catch(() => false)) {
      await menuBtn.click();
      await beat(page, 400);
    }
  }
  await settingsBtn.click();
  await expect(page.getByRole("heading", { name: "Google Drive Sync" })).toBeVisible();
  await beat(page, 1200);

  await caption(
    page,
    "Return to files and create a new document offline — it saves locally and queues for Drive.",
    1800,
  );
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 600);

  const newBtn = page.getByRole("button", { name: "New", exact: true }).first();
  await newBtn.click();
  await beat(page, 400);
  await page.getByRole("button", { name: "New document" }).click();
  await beat(page, 1000);

  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.waitFor({ timeout: 15000 });
  await editor.click({ position: { x: 120, y: 40 } });
  await typeSlowly(page, "Field notes from Android companion.", 35);
  await beat(page, 1000);

  await caption(
    page,
    "Open the AI Assistant — Android uses on-device AICore (Gemini Nano Full) instead of wllama.",
    1800,
  );
  const aiBtn = page.getByRole("button", { name: "AI assistant" }).first();
  if (await aiBtn.isVisible().catch(() => false)) {
    await aiBtn.click();
    await beat(page, 1200);
  }
  await caption(page, "", 400);
});

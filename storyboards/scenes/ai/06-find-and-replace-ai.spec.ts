import { askAgent, beat, caption, describeRun, electronMode, expect, openApp, test, typeSlowly } from "../harness";

const letter = [
  "Dear volunteers,",
  "Thank you for a wonderful season.",
  "We were happy to recieve so many seed donations this spring.",
  "You will recieve a printed harvest calendar at the supper on Saturday.",
  "If you did not recieve your new gloves, please ask Ruth at the shed.",
  "With warm wishes, the committee",
];

test("06-find-and-replace-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Priya is writing a thank-you letter to the garden volunteers.");
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await expect(title).toBeVisible();
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Thank-you letter");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  for (const line of letter) {
    await typeSlowly(page, line, 18);
    await page.keyboard.press("Enter");
  }
  await caption(page, "Before sending it, she asks the on-device assistant to check her spelling.", 1600);

  const run = await askAgent(page, "Could you check the spelling in my letter and fix any mistakes?");
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(editor, why).not.toContainText("recieve");
  await expect(editor.getByText(/receive/), why).toHaveCount(3);
  await expect(editor.locator(":scope > p").filter({ hasText: /\S/ }), why).toHaveText(
    letter.map((line) => line.replace("recieve", "receive")),
  );
  await expect(title, why).toHaveValue("Thank-you letter");
  const spelling = page.getByRole("complementary", { name: "Spelling and grammar" });
  await expect(spelling, why).toContainText("No spelling mistakes found.");
  await caption(page, "Gemma ran the spelling check, found \"recieve\" three times and replaced all three with \"receive\".", 2400);

  await expect(page.getByRole("status"), why).toContainText(electronMode ? "Draft saved" : "Saved");
  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 600);
  await caption(
    page,
    `The rest of the letter is unchanged, the spelling panel has nothing left to check, and the letter is ${electronMode ? "kept as a draft until she chooses Save As" : "saved"}.`,
    2400,
  );
  await beat(page, 600);
});

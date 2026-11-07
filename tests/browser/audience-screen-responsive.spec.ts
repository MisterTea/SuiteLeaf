import { expect, test } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src/native-file";

test("the audience popup stays separate from the editor across refresh and slide changes", async ({
  page,
}) => {
  await page.goto("/");
  const file = createFile("slide", "Audience popup");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const first = file.content.slides[file.content.slideOrder[0]]!;
  first.elements = [
    {
      id: "title",
      type: "text",
      x: 50,
      y: 50,
      width: 600,
      height: 100,
      content: "Welcome audience",
    },
  ];
  first.notes = "Private presenter notes";
  const second = {
    ...first,
    id: "second",
    elements: [
      {
        ...first.elements[0]!,
        id: "second-title",
        content: "Next audience slide",
      },
    ],
  };
  file.content.slides.second = second;
  file.content.slideOrder.push("second");
  await page
    .locator("input[type=file]:not([webkitdirectory])")
    .setInputFiles({
      name: "audience.slslides",
      mimeType: "application/json",
      buffer: Buffer.from(serializeFile(file)),
    });
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Audience screen", exact: true })
    .click();
  const audience = await opened;
  await expect(
    audience.getByRole("heading", { name: "Welcome audience" }),
  ).toBeVisible();
  expect(audience.url()).toMatch(/^blob:/);
  await audience.reload();
  await expect(
    audience.getByRole("heading", { name: "Welcome audience" }),
  ).toBeVisible();
  await expect(audience.getByText("Private presenter notes")).toHaveCount(0);
  await page.bringToFront();
  await page.keyboard.press("ArrowRight");
  await expect(
    audience.getByRole("heading", { name: "Next audience slide" }),
  ).toBeVisible();
  expect(audience.url()).toMatch(/^blob:/);
  await expect(page.getByRole("dialog", { name: "Slideshow" })).toBeVisible();
  await audience.close();
});

import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "Garden club minutes",
        footer: "",
        pageNumbers: true,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October meeting" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Present: Ben, Ruth, Marek, Asha and Joy. The committee agreed the harvest supper for 14 November.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Actions" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Ruth will order timber. Asha will book the hall.",
          },
        ],
      },
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutes())),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
}

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

test("page number format and position stay separate from the footer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await openMinutes(page);
  await expect(page.locator(".page-number")).toHaveText(["1 / 2", "2 / 2"]);
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "right");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const fraction = setup.getByRole("radio", { name: "1 / 2" });
  const pageWord = setup.getByRole("radio", { name: "Page 1" });
  const bottomRight = setup.getByRole("radio", { name: "Bottom right" });
  const bottomCenter = setup.getByRole("radio", { name: "Bottom center" });
  const topRight = setup.getByRole("radio", { name: "Top right" });
  await expect(fraction).toBeChecked();
  await expect(pageWord).toBeVisible();
  await expect(bottomRight).toBeChecked();
  await expect(bottomCenter).toBeVisible();
  await expect(topRight).toBeVisible();
  await expect(setup.locator("#page-numbers-hint")).toContainText("Bottom right");
  await fraction.focus();
  await page.keyboard.press("ArrowRight");
  await expect(pageWord).toBeChecked();
  await bottomCenter.check();
  await expect(setup.locator("#page-numbers-hint")).toContainText("Bottom center");
  await expect(setup.locator("#page-numbers-hint")).toContainText("Page 1");
  await expect(setup.locator("#page-numbers-hint")).toContainText("footer");
  await setup.getByLabel("Page footer").fill("Committee draft");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  await expect(page.locator(".page-number")).toHaveText(["Page 1", "Page 2"]);
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "center");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "center");
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Committee draft");
  await expect(face(page, 0).locator(".page-number")).toHaveText("Page 1");
  await expect(page.locator(".page-number-top")).toHaveCount(0);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setup.getByLabel("Page footer").fill("Draft for members");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft for members");
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText("Draft for members");
  await expect(page.locator(".page-number")).toHaveText(["Page 1", "Page 2"]);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await topRight.check();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "top-right");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "top-right");
  await expect(face(page, 0).locator(".page-number")).toHaveText("Page 1");
  await expect(face(page, 1).locator(".page-number")).toHaveText("Page 2");
  await expect(face(page, 0).locator(".page-footer")).not.toContainText("Page");
  await expect(face(page, 1).locator(".page-footer")).not.toContainText("Page");
  await expect(face(page, 0).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft for members");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await bottomRight.check();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 0).locator(".page-footer .page-number")).toHaveText("Page 1");
  await expect(page.locator(".page-number-top")).toHaveCount(0);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await topRight.check();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    pageNumbers: true,
    pageNumberFormat: "page",
    pageNumberPosition: "top-right",
    pageNumberPositionSet: true,
    footer: "Draft for members",
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-number")).toHaveText(["Page 1", "Page 2"]);
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "top-right");
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft for members");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setup.getByLabel("Page numbers").uncheck();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-number")).toHaveCount(0);
  await expect(face(page, 0).locator(".page-footer-text")).toHaveText("Draft for members");
  await expect(face(page, 1).locator(".page-footer-text")).toHaveText("Draft for members");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(setup.getByRole("radio", { name: "Page 1" })).toBeChecked();
  await expect(setup.getByRole("radio", { name: "Top right" })).toBeChecked();
  await setup.getByLabel("Page numbers").check();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-number")).toHaveText(["Page 1", "Page 2"]);
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "top-right");
  await expect(face(page, 0).locator(".page-footer")).not.toContainText("Page");

  const centered = async () => {
    await page.getByRole("button", { name: "Page setup", exact: true }).click();
    await setup.getByRole("radio", { name: "Bottom center" }).check();
    await setup.getByRole("button", { name: "Apply", exact: true }).click();
    const pageBox = await face(page, 0).boundingBox();
    const numberBox = await face(page, 0).locator(".page-number").boundingBox();
    expect(pageBox && numberBox).toBeTruthy();
    const pageMid = pageBox!.x + pageBox!.width / 2;
    const numberMid = numberBox!.x + numberBox!.width / 2;
    expect(Math.abs(pageMid - numberMid)).toBeLessThan(8);
    const footerBox = await face(page, 0).locator(".page-footer").boundingBox();
    expect(footerBox).toBeTruthy();
    expect(numberBox!.y).toBeGreaterThan(footerBox!.y - 4);
    expect(numberBox!.y).toBeLessThan(footerBox!.y + footerBox!.height);
  };
  await centered();
  const topBox = async () => {
    await page.getByRole("button", { name: "Page setup", exact: true }).click();
    await setup.getByRole("radio", { name: "Top right" }).check();
    await setup.getByRole("button", { name: "Apply", exact: true }).click();
    const pageBox = await face(page, 0).boundingBox();
    const headerBox = await face(page, 0).locator(".page-header").boundingBox();
    const numberBox = await face(page, 0).locator(".page-number").boundingBox();
    const footerBox = await face(page, 0).locator(".page-footer").boundingBox();
    expect(pageBox && headerBox && numberBox && footerBox).toBeTruthy();
    expect(numberBox!.y).toBeLessThan(footerBox!.y);
    expect(Math.abs(numberBox!.y - headerBox!.y)).toBeLessThan(16);
    expect(numberBox!.x + numberBox!.width).toBeGreaterThan(pageBox!.x + pageBox!.width - 12);
    expect(numberBox!.x).toBeGreaterThan(headerBox!.x + 40);
  };
  await topBox();
  expect(errors).toEqual([]);
});

import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type JsonNode } from "../../packages/core/src";

const welcome =
  "Welcome to the October meeting of the Riverside Garden Club. We are glad you came to the greenhouse this evening. Before the frost we need to decide the south bed, and we want this welcome to stay easy to read while the vote itself stays compact. Please take a copy of the minutes and a seat near the door.";
const motion = [
  "Plant the south bed with beans.",
  "Second the motion and open the vote.",
  "The vote carries if members present agree.",
];

function item(text: string): JsonNode {
  return {
    type: "listItem",
    content: [
      {
        type: "paragraph",
        attrs: { lineSpacing: "double" },
        content: [{ type: "text", text }],
      },
    ],
  };
}

function paragraph(page: Page, text: string) {
  if (text === "Motion")
    return page.locator(".document-content h2", { hasText: /^Motion$/ });
  return page.locator(".document-content p", { hasText: text });
}

async function textEdge(page: Page, text: string, edge: "top" | "bottom") {
  return paragraph(page, text).evaluate((el, which) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
    if (!rects.length) throw new Error("no text");
    return which === "top" ? rects[0].top : rects[rects.length - 1].bottom;
  }, edge);
}

async function openMinutes(page: Page) {
  const file = createFile("doc", "Garden club minutes");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { lineSpacing: "1.5" },
        content: [{ type: "text", text: welcome }],
      },
      {
        type: "heading",
        attrs: { level: 2, spaceBefore: 0, spaceAfter: 0 },
        content: [{ type: "text", text: "Motion" }],
      },
      { type: "bulletList", content: motion.map(item) },
    ],
  };
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "greenhouse",
  );
}

async function setSpace(page: Page, name: "Space before" | "Space after", points: string) {
  const control = page.getByRole("button", { name: /Line spacing/ });
  await control.click();
  const field = page.getByRole("textbox", { name, exact: true });
  await expect(field).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await field.fill(points);
  await field.press("Enter");
  await page.keyboard.press("Escape");
}

test.use({ viewport: { width: 1280, height: 800 } });

test("space before and after follow the caret, leave line spacing, and survive save", async ({
  page,
}) => {
  await openMinutes(page);
  await paragraph(page, "greenhouse").click();
  const control = page.getByRole("button", { name: /Line spacing/ });
  await expect(control).toContainText("1.5");
  await expect(control).toHaveAttribute("aria-label", /Space before 0 points/);
  await expect(control).toHaveAttribute("aria-label", /Space after 0 points/);
  const welcomeAdvance = await paragraph(page, "greenhouse").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
    return rects[1].top - rects[0].top;
  });
  const glued = (await textEdge(page, "Motion", "top")) - (await textEdge(page, "greenhouse", "bottom"));
  const motionGap =
    (await textEdge(page, motion[1], "top")) - (await textEdge(page, motion[0], "bottom"));

  await setSpace(page, "Space after", "12");
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await expect(paragraph(page, "greenhouse")).not.toHaveAttribute("data-space-before");
  await expect(paragraph(page, "Motion")).toHaveAttribute("data-space-after", "0");
  for (const line of motion) {
    await expect(paragraph(page, line)).toHaveAttribute("data-line-spacing", "double");
    await expect(paragraph(page, line)).not.toHaveAttribute("data-space-after");
  }
  const afterWelcome =
    (await textEdge(page, "Motion", "top")) - (await textEdge(page, "greenhouse", "bottom"));
  expect(afterWelcome).toBeGreaterThan(glued + 10);
  expect(
    (await textEdge(page, motion[1], "top")) - (await textEdge(page, motion[0], "bottom")),
  ).toBeLessThan(motionGap + 4);
  const advanceAfter = await paragraph(page, "greenhouse").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
    return rects[1].top - rects[0].top;
  });
  expect(Math.abs(advanceAfter - welcomeAdvance)).toBeLessThan(1);

  await paragraph(page, "Motion").click();
  await setSpace(page, "Space before", "12");
  await expect(paragraph(page, "Motion")).toHaveAttribute("data-space-before", "12");
  await expect(paragraph(page, "Motion")).toHaveAttribute("data-space-after", "0");
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  const aboveHeading =
    (await textEdge(page, "Motion", "top")) - (await textEdge(page, "greenhouse", "bottom"));
  expect(aboveHeading).toBeGreaterThan(afterWelcome + 10);

  await paragraph(page, "greenhouse").click();
  await expect(control).toHaveAttribute("aria-label", /Space after 12 points/);
  await control.click();
  await expect(page.getByRole("textbox", { name: "Space after", exact: true })).toHaveValue("12");
  await expect(page.getByRole("textbox", { name: "Space before", exact: true })).toHaveValue("0");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await paragraph(page, motion[0]).click();
  await paragraph(page, motion[2]).click({ modifiers: ["Shift"] });
  await expect(control).toContainText("Double");
  await setSpace(page, "Space after", "12");
  for (const line of motion)
    await expect(paragraph(page, line)).toHaveAttribute("data-space-after", "12");
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(paragraph(page, "Motion")).toHaveAttribute("data-space-before", "12");
  const spread =
    (await textEdge(page, motion[1], "top")) - (await textEdge(page, motion[0], "bottom"));
  expect(spread).toBeGreaterThan(motionGap + 10);

  await setSpace(page, "Space after", "0");
  for (const line of motion) {
    await expect(paragraph(page, line)).toHaveAttribute("data-space-after", "0");
    await expect(paragraph(page, line)).toHaveAttribute("data-line-spacing", "double");
  }
  expect(
    (await textEdge(page, motion[1], "top")) - (await textEdge(page, motion[0], "bottom")),
  ).toBeLessThan(motionGap + 4);
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await expect(paragraph(page, "Motion")).toHaveAttribute("data-space-before", "12");
  await paragraph(page, motion[1]).click();
  await expect(control).toContainText("Double");
  await expect(control).toHaveAttribute("aria-label", /Space after 0 points/);

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden club minutes" }).click();
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(paragraph(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await expect(paragraph(page, "Motion")).toHaveAttribute("data-space-before", "12");
  for (const line of motion) {
    await expect(paragraph(page, line)).toHaveAttribute("data-space-after", "0");
    await expect(paragraph(page, line)).toHaveAttribute("data-line-spacing", "double");
  }
  await paragraph(page, "Motion").click();
  await expect(page.getByRole("button", { name: /Line spacing/ })).toHaveAttribute(
    "aria-label",
    /Space before 12 points/,
  );
});

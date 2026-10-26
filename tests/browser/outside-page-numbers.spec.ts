import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function preface(): DocFile {
  const file = createFile("doc", "Preface") as DocFile;
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "",
        footer: "",
        headerFromEdge: inch(0.5),
        footerFromEdge: inch(0.5),
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Preface" }],
      },
      paragraph("The front matter starts here."),
      { type: "pageBreak" },
      paragraph("Notes on the second page."),
      { type: "pageBreak" },
      paragraph("Notes on the third page."),
      { type: "pageBreak" },
      paragraph("Notes on the fourth page."),
      { type: "pageBreak" },
      paragraph("The index ends the preface."),
    ],
  };
  return file;
}

async function openPreface(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Preface.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface())),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The index ends the preface.",
  );
}

async function openSetup(page: Page) {
  const button = page.getByRole("button", { name: "Page setup", exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole("button", { name: "More tools", exact: true }).click();
    await expect(button).toBeVisible();
  }
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectSheet(
  page: Page,
  which: "last-even" | "last-odd" | number,
  numeral: string,
  corner: "top-left" | "top-right",
) {
  const face =
    typeof which === "number"
      ? page.locator(".page-setup-preview-sheet").nth(which)
      : page.locator(`[data-preview-role="${which}"] .page-setup-preview-sheet`);
  await expect(face).toHaveAttribute("data-number-corner", corner);
  await expect(face.locator(".page-setup-preview-number")).toHaveText(numeral);
  await expect
    .poll(() =>
      face.evaluate((el, side) => {
        const number = el.querySelector(".page-setup-preview-number");
        if (!number) return "missing number";
        const s = el.getBoundingClientRect();
        const n = number.getBoundingClientRect();
        const inside =
          n.left >= s.left - 1 &&
          n.right <= s.right + 1 &&
          n.top >= s.top - 1 &&
          n.bottom <= s.bottom + 1 &&
          n.width > 8;
        const onLeft = n.left - s.left <= 18 && n.right < s.left + s.width * 0.72;
        const onRight = s.right - n.right <= 18 && n.left > s.left + s.width * 0.28;
        const atTop = n.top - s.top <= 18 && n.bottom < s.top + s.height * 0.45;
        const placed = side === "top-left" ? onLeft && atTop : onRight && atTop;
        if (inside && placed) return "ok";
        return JSON.stringify({
          inside,
          placed,
          left: Math.round(n.left - s.left),
          right: Math.round(s.right - n.right),
          top: Math.round(n.top - s.top),
        });
      }, corner),
    )
    .toBe("ok");
}

async function expectDocument(
  page: Page,
  index: number,
  numeral: string,
  corner: "top-left" | "top-right",
) {
  const face = page.locator(".page-furniture-page").nth(index);
  await expect(face).toHaveAttribute("data-number-side", corner);
  await expect(face.locator(".page-number")).toHaveText(numeral);
  await expect
    .poll(() =>
      face.evaluate((el, side) => {
        const number = el.querySelector(".page-number");
        if (!number) return "missing number";
        const s = el.getBoundingClientRect();
        const n = number.getBoundingClientRect();
        const onLeft = n.left - s.left <= 24 && n.right < s.left + s.width * 0.62;
        const onRight = s.right - n.right <= 24 && n.left > s.left + s.width * 0.38;
        const atTop = n.top - s.top < s.height * 0.22 && n.bottom < s.top + s.height * 0.4;
        const placed = side === "top-left" ? onLeft && atTop : onRight && atTop;
        if (placed) return "ok";
        return JSON.stringify({
          placed,
          left: Math.round(n.left - s.left),
          right: Math.round(s.right - n.right),
          top: Math.round(n.top - s.top),
          width: Math.round(s.width),
        });
      }, corner),
    )
    .toBe("ok");
}

test("a top-right number moves to the outside edge before apply and stays after reopen", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPreface(page);
  await expectDocument(page, 3, "Page 4", "top-right");
  await expectDocument(page, 4, "Page 5", "top-right");

  let dialog = await openSetup(page);
  const oddEven = dialog.getByRole("checkbox", { name: "Different odd and even pages" });
  await expect(oddEven).not.toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expectSheet(page, 0, "Page 1", "top-right");
  await expectSheet(page, 1, "Page 5", "top-right");
  await expectDocument(page, 3, "Page 4", "top-right");

  await oddEven.check();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expect(dialog.locator(".page-setup-preview-number")).toHaveText(["Page 4", "Page 5"]);
  await expectSheet(page, "last-even", "Page 4", "top-left");
  await expectSheet(page, "last-odd", "Page 5", "top-right");
  await expectDocument(page, 3, "Page 4", "top-left");
  await expectDocument(page, 4, "Page 5", "top-right");
  await expect(dialog.getByText("The number sits on the outside edge.")).toBeVisible();

  await oddEven.uncheck();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await expectSheet(page, 0, "Page 1", "top-right");
  await expectSheet(page, 1, "Page 5", "top-right");
  await expectDocument(page, 3, "Page 4", "top-right");
  await expectDocument(page, 4, "Page 5", "top-right");

  await oddEven.check();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await expectDocument(page, 3, "Page 4", "top-left");
  await expectDocument(page, 4, "Page 5", "top-right");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The front matter starts here.",
  );
  await expectDocument(page, 3, "Page 4", "top-left");
  await expectDocument(page, 4, "Page 5", "top-right");
  dialog = await openSetup(page);
  await expect(
    dialog.getByRole("checkbox", { name: "Different odd and even pages" }),
  ).toBeChecked();
  await expectSheet(page, "last-even", "Page 4", "top-left");
  await expectSheet(page, "last-odd", "Page 5", "top-right");
});

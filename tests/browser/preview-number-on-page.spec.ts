import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

const inch = (n: number) => n * 96;

function preface(pages: string[]): DocFile {
  const file = createFile("doc", "Preface") as DocFile;
  const blocks: DocFile["content"]["content"] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Preface" }],
    },
  ];
  pages.forEach((text, index) => {
    if (index > 0) blocks.push({ type: "pageBreak" });
    blocks.push({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
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
        pageNumberFormat: "roman",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 4,
      },
    },
    content: blocks,
  };
  return file;
}

async function openPreface(page: Page, pages: string[]) {
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Preface.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(preface(pages))),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    pages[0]!,
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

function sheets(page: Page) {
  return page.locator(".page-setup-preview-sheet");
}

async function expectCorner(
  page: Page,
  index: number,
  numeral: string,
  corner: "top-right" | "bottom-center",
) {
  const sheet = sheets(page).nth(index);
  await expect(sheet).toHaveAttribute("data-number-corner", corner);
  await expect(sheet.locator(".page-setup-preview-number")).toHaveText(numeral);
  await expect
    .poll(() =>
      sheet.evaluate((el, which) => {
        const number = el.querySelector(".page-setup-preview-number");
        if (!number) return "missing number";
        const s = el.getBoundingClientRect();
        const n = number.getBoundingClientRect();
        const pageShaped = s.height >= s.width * 1.2 && s.width >= 80;
        const inside =
          n.left >= s.left - 1 &&
          n.right <= s.right + 1 &&
          n.top >= s.top - 1 &&
          n.bottom <= s.bottom + 1 &&
          n.width > 8 &&
          n.height > 8;
        const cx = (n.left + n.right) / 2;
        const inTopRight =
          n.top - s.top <= s.height * 0.22 &&
          s.right - n.right <= 14 &&
          cx >= s.left + s.width * 0.55;
        const inBottomCenter =
          s.bottom - n.bottom <= 14 &&
          Math.abs(cx - (s.left + s.width / 2)) <= 10 &&
          n.top >= s.top + s.height * 0.62;
        const cornerOk = which === "top-right" ? inTopRight : inBottomCenter;
        if (pageShaped && inside && cornerOk) return "ok";
        return JSON.stringify({
          pageShaped,
          inside,
          cornerOk,
          sheet: { w: Math.round(s.width), h: Math.round(s.height) },
          number: {
            top: Math.round(n.top - s.top),
            right: Math.round(s.right - n.right),
            bottom: Math.round(s.bottom - n.bottom),
            cx: Math.round(cx - s.left),
          },
        });
      }, corner),
    )
    .toBe("ok");
}

const five = [
  "The front matter starts here.",
  "Notes on the second page.",
  "Notes on the third page.",
  "Notes on the fourth page.",
  "The index ends the preface.",
];

test("the preview draws iv and viii in the chosen corner before apply and after reopen", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPreface(page, five);
  let dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv … viii", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expect(sheets(page)).toHaveCount(2);
  await expect(dialog.locator(".page-setup-preview-skip")).toHaveCount(1);
  await expectCorner(page, 0, "iv", "top-right");
  await expectCorner(page, 1, "viii", "top-right");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeVisible();

  await dialog.getByRole("radio", { name: "Bottom center", exact: true }).check();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await expectCorner(page, 0, "iv", "bottom-center");
  await expectCorner(page, 1, "viii", "bottom-center");

  await dialog.getByRole("radio", { name: "Top right", exact: true }).check();
  await expectCorner(page, 0, "iv", "top-right");
  await expectCorner(page, 1, "viii", "top-right");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The front matter starts here.",
  );
  dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv … viii", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 8", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Top right", exact: true })).toBeChecked();
  await expectCorner(page, 0, "iv", "top-right");
  await expectCorner(page, 1, "viii", "top-right");
});

test("a two-page file previews exactly two small pages", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPreface(page, [
    "The front matter starts here.",
    "Notes on the second page.",
  ]);
  const dialog = await openSetup(page);
  await expect(dialog.getByRole("radio", { name: "iv, v", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "4 / 5", exact: true })).toBeVisible();
  await expect(sheets(page)).toHaveCount(2);
  await expect(dialog.locator(".page-setup-preview-skip")).toHaveCount(0);
  await expect(dialog.locator(".page-setup-preview-page")).toHaveCount(2);
  await expectCorner(page, 0, "iv", "top-right");
  await expectCorner(page, 1, "v", "top-right");
});

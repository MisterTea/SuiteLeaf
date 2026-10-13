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
        pageNumberPosition: "bottom-right",
        pageNumberPositionSet: false,
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
  await page.locator("input[type=file]").setInputFiles({
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

function sheet(page: Page, role: "last-even" | "last-odd" | number) {
  if (typeof role === "number") return page.locator(".page-setup-preview-sheet").nth(role);
  return page.locator(`[data-preview-role="${role}"] .page-setup-preview-sheet`);
}

async function expectCorner(
  page: Page,
  which: "last-even" | "last-odd" | number,
  numeral: string,
  corner: "bottom-left" | "bottom-right",
) {
  const face = sheet(page, which);
  await expect(face).toHaveAttribute("data-number-corner", corner);
  await expect(face.locator(".page-setup-preview-number")).toHaveText(numeral);
  await expect
    .poll(() =>
      face.evaluate((el, side) => {
        const number = el.querySelector(".page-setup-preview-number");
        if (!number) return "missing number";
        const s = el.getBoundingClientRect();
        const n = number.getBoundingClientRect();
        const pageShaped = s.height >= s.width * 1.15 && s.width >= 64;
        const inside =
          n.left >= s.left - 1 &&
          n.right <= s.right + 1 &&
          n.top >= s.top - 1 &&
          n.bottom <= s.bottom + 1 &&
          n.width > 8 &&
          n.height > 8;
        const onLeft = n.left - s.left <= 16 && n.right < s.left + s.width * 0.72;
        const onRight = s.right - n.right <= 16 && n.left > s.left + s.width * 0.28;
        const atBottom = s.bottom - n.bottom <= 16 && n.top >= s.top + s.height * 0.55;
        const placed = side === "bottom-left" ? onLeft && atBottom : onRight && atBottom;
        if (pageShaped && inside && placed) return "ok";
        return JSON.stringify({
          pageShaped,
          inside,
          placed,
          sheet: { w: Math.round(s.width), h: Math.round(s.height) },
          number: {
            left: Math.round(n.left - s.left),
            right: Math.round(s.right - n.right),
            bottom: Math.round(s.bottom - n.bottom),
          },
        });
      }, corner),
    )
    .toBe("ok");
}

test("the odd and even preview shows the last pages before apply and after reopen", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPreface(page);
  let dialog = await openSetup(page);
  const oddEven = dialog.getByRole("checkbox", { name: "Different odd and even pages" });
  await expect(oddEven).not.toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Page 1", exact: true })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: "Bottom right", exact: true })).toBeChecked();
  await expect(dialog.locator(".page-setup-preview-sheet")).toHaveCount(2);
  await expect(dialog.locator(".page-setup-preview-skip-label")).toHaveText(
    "Pages 2\u20134 skipped",
  );
  await expectCorner(page, 0, "Page 1", "bottom-right");
  await expectCorner(page, 1, "Page 5", "bottom-right");
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();

  await oddEven.check();
  await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await expect(dialog.locator(".page-setup-preview-sheet")).toHaveCount(2);
  await expect(dialog.locator(".page-setup-preview-skip")).toHaveCount(0);
  await expect(dialog.locator("[data-preview-role='last-even']")).toContainText(
    "Page 4 · last even",
  );
  await expect(dialog.locator("[data-preview-role='last-odd']")).toContainText(
    "Page 5 · last odd",
  );
  await expectCorner(page, "last-even", "Page 4", "bottom-left");
  await expectCorner(page, "last-odd", "Page 5", "bottom-right");
  const order = await dialog.evaluate(() => {
    const even = document.querySelector("[data-preview-role='last-even']");
    const odd = document.querySelector("[data-preview-role='last-odd']");
    if (!even || !odd) return "missing";
    return even.getBoundingClientRect().left < odd.getBoundingClientRect().left
      ? "even-left"
      : "odd-left";
  });
  expect(order).toBe("even-left");

  await oddEven.uncheck();
  await expect(dialog.getByRole("radio", { name: "Bottom right", exact: true })).toBeChecked();
  await expect(dialog.locator(".page-setup-preview-sheet")).toHaveCount(2);
  await expectCorner(page, 0, "Page 1", "bottom-right");
  await expectCorner(page, 1, "Page 5", "bottom-right");

  await oddEven.check();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".save-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Preface" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "The front matter starts here.",
  );
  dialog = await openSetup(page);
  await expect(
    dialog.getByRole("checkbox", { name: "Different odd and even pages" }),
  ).toBeChecked();
  await expectCorner(page, "last-even", "Page 4", "bottom-left");
  await expectCorner(page, "last-odd", "Page 5", "bottom-right");
});

test("the odd and even preview fits beside the switch on a phone", async ({ page }) => {
  await openPreface(page);
  const dialog = await openSetup(page);
  await dialog.getByRole("checkbox", { name: "Different odd and even pages" }).check();
  const preview = dialog.getByRole("group", { name: "Page preview" });
  await preview.scrollIntoViewIfNeeded();
  await expect(preview.locator(".page-setup-preview-number")).toHaveText([
    "Page 4",
    "Page 5",
  ]);
  const fit = await preview.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const parent = el.closest(".dialog-body")?.getBoundingClientRect();
    if (!parent) return "no body";
    const inside = box.left >= parent.left - 1 && box.right <= parent.right + 1;
    return inside ? "ok" : `overflow ${Math.round(box.right - parent.right)}`;
  });
  expect(fit).toBe("ok");
});

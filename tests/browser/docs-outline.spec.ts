import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

test.use({ viewport: { width: 1280, height: 800 } });

const stageScroll = (page: Page) =>
  page.locator(".document-stage").evaluate((el) => el.scrollTop);

test("End moves to the end of the line and Enter keeps the page still", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "End moves within the line on a desktop keyboard.");
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.type("Heading line");
  await page
    .getByRole("combobox", { name: "Paragraph style" })
    .selectOption({ label: "Heading 1" });
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
  const before = await stageScroll(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Body");
  await expect(editor.locator("h1")).toHaveText("Heading line");
  await expect(editor.locator("p").first()).toHaveText("Body");
  await page.keyboard.press("Home");
  await page.keyboard.type("A ");
  await expect(editor.locator("p").first()).toHaveText("A Body");
  expect(Math.abs((await stageScroll(page)) - before)).toBeLessThanOrEqual(2);
});

const sections: [string, number, string?][] = [
  ["Summary", 1, "Riverside Community Garden had its busiest year yet. Forty-two households tended plots, the waiting list fell from thirty names to nine, and the new rainwater tanks carried us through the dry spell in July without a single hosepipe day. This report sets out what we grew, who helped, how the money was spent, and what we plan for next season."],
  ["Growing season", 1],
  ["Spring planting", 2, "A cold April delayed the first sowings by about two weeks. Members moved tomatoes and squash into the greenhouse until mid-May, and the shared seed library lent out more than three hundred packets. Broad beans, early potatoes and salad leaves did especially well in the raised beds by the north fence, where the new compost had been dug in over winter."],
  ["Summer harvest", 2, "July and August brought the heaviest harvest in the garden's history. We weighed four hundred and twelve kilograms of produce at the Saturday sessions, and members donated just over a quarter of it to the food bank on Mill Street. Courgettes, runner beans and soft fruit were the stars; sweetcorn struggled in the wind and will move to a sheltered bed next year."],
  ["Volunteers", 1, "Twenty-six volunteers gave roughly nine hundred hours this year. The Tuesday work party rebuilt the tool shed roof, the school gardening club planted a wildflower border along the path, and three members completed first-aid training. We thank every one of them, and especially Ruth Okafor, who stepped down after eight years as plot secretary."],
  ["Budget", 1],
  ["Income", 2, "Plot fees raised four thousand one hundred pounds. The plant sale in May added nine hundred and sixty pounds, and a grant from the town council covered most of the rainwater tanks. Donations through the honesty box at the gate came to about two hundred pounds, roughly the same as last year."],
  ["Expenses", 2, "The largest costs were the rainwater tanks, the water bill, and timber for the shed roof. Insurance rose by twelve percent. We ended the year with a surplus of six hundred and forty pounds, which the committee proposes to set aside for replacing the greenhouse glazing in two years' time."],
  ["Next year", 1, "Priorities for next season are an accessible raised bed near the gate, a second compost bay, and a monthly open day for neighbours who are curious about joining. The committee will present a detailed plan at the spring general meeting."],
];

async function openReport(page: Page) {
  const file = createFile("doc", "Annual report");
  if (file.kind !== "doc") throw new Error();
  const text = (text: string) => [{ type: "text", text }];
  file.content = {
    type: "doc",
    content: sections.flatMap(([title, level, body]) => [
      { type: "heading", attrs: { level }, content: text(title) },
      ...(body ? [{ type: "paragraph", content: text(body) }] : []),
    ]),
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "report.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.locator(".outline-item")).toHaveCount(sections.length);
  await expect(page.locator(".editor-status")).toContainText("2 pages");
}

test("headings stay on the same page as the paragraph after them", async ({
  page,
}) => {
  await openReport(page);
  const pages = await page.locator(".paginated-paper").evaluate((paper) => {
    const stride = parseFloat(
      getComputedStyle(paper).getPropertyValue("--page-stride"),
    );
    const box = paper.getBoundingClientRect();
    const zoom = box.height / (paper as HTMLElement).offsetHeight;
    const pageOf = (y: number) => Math.floor((y - box.top) / zoom / stride);
    return [...paper.querySelectorAll(".document-content h1, .document-content h2")]
      .filter((h) => h.nextElementSibling)
      .map((h) => {
        let next = h.nextElementSibling!;
        while (next.classList.contains("doc-page-spacer"))
          next = next.nextElementSibling!;
        return {
          heading: h.textContent,
          headingPage: pageOf(h.getBoundingClientRect().bottom - 1),
          nextPage: pageOf(next.getBoundingClientRect().top + 1),
        };
      });
  });
  for (const p of pages)
    expect(p.nextPage, `${p.heading} is kept with the text after it`).toBe(
      p.headingPage,
    );
});

test("outline indents subheadings, jumps to a heading and highlights the current section", async ({
  page,
}) => {
  await openReport(page);
  const outline = page.locator(".outline");
  const textLeft = (name: string) =>
    outline
      .getByRole("button", { name, exact: true })
      .evaluate((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return range.getBoundingClientRect().left;
      });
  expect((await textLeft("Spring planting")) - (await textLeft("Growing season")))
    .toBeGreaterThanOrEqual(16);

  const current = outline.locator("[aria-current=location]");
  await expect(current).toHaveText("Summary");

  const editor = page.getByRole("textbox", { name: "Document content" });
  const headingOffset = async (name: string) => {
    const stage = (await page.locator(".document-stage").boundingBox())!;
    const heading = (await editor
      .getByRole("heading", { name, exact: true })
      .boundingBox())!;
    return heading.y - stage.y;
  };
  for (const name of ["Expenses", "Volunteers", "Summary"]) {
    await outline.getByRole("button", { name, exact: true }).click();
    await expect(current).toHaveText(name);
    const offset = await headingOffset(name);
    if (name !== "Summary") {
      expect(offset).toBeGreaterThanOrEqual(8);
      expect(offset).toBeLessThanOrEqual(64);
    }
  }

  await page.locator(".document-stage").evaluate((stage) => {
    const budget = [...stage.querySelectorAll(".document-content h1")].find(
      (h) => h.textContent === "Budget",
    )!;
    stage.scrollBy({
      top:
        budget.getBoundingClientRect().top -
        stage.getBoundingClientRect().top -
        10,
    });
  });
  await expect(current).toHaveText("Budget");
});

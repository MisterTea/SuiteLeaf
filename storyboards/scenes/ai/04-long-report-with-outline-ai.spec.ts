import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

const report: [string, string, string?][] = [
  ["Summary", "Heading 1", "Riverside Community Garden had its busiest year yet. Forty-two households tended plots, the waiting list fell from thirty names to nine, and the new rainwater tanks carried us through the dry spell in July without a single hosepipe day. This report sets out what we grew, who helped, how the money was spent, and what we plan for next season."],
  ["Growing season", "Heading 1"],
  ["Spring planting", "Heading 2", "A cold April delayed the first sowings by about two weeks. Members moved tomatoes and squash into the greenhouse until mid-May, and the shared seed library lent out more than three hundred packets. Broad beans, early potatoes and salad leaves did especially well in the raised beds by the north fence, where the new compost had been dug in over winter."],
  ["Summer harvest", "Heading 2", "July and August brought the heaviest harvest in the garden's history. We weighed four hundred and twelve kilograms of produce at the Saturday sessions, and members donated just over a quarter of it to the food bank on Mill Street. Courgettes, runner beans and soft fruit were the stars; sweetcorn struggled in the wind and will move to a sheltered bed next year."],
  ["Volunteers", "Heading 1", "Twenty-six volunteers gave roughly nine hundred hours this year. The Tuesday work party rebuilt the tool shed roof, the school gardening club planted a wildflower border along the path, and three members completed first-aid training. We thank every one of them, and especially Ruth Okafor, who stepped down after eight years as plot secretary."],
  ["Budget", "Heading 1"],
  ["Income", "Heading 2", "Plot fees raised four thousand one hundred pounds. The plant sale in May added nine hundred and sixty pounds, and a grant from the town council covered most of the rainwater tanks. Donations through the honesty box at the gate came to about two hundred pounds, roughly the same as last year."],
  ["Expenses", "Heading 2", "The largest costs were the rainwater tanks, the water bill, and timber for the shed roof. Insurance rose by twelve percent. We ended the year with a surplus of six hundred and forty pounds, which the committee proposes to set aside for replacing the greenhouse glazing in two years' time."],
  ["Next year", "Heading 1", "Priorities for next season are an accessible raised bed near the gate, a second compost bay, and a monthly open day for neighbours who are curious about joining. The committee will present a detailed plan at the spring general meeting."],
];

/** The report as Tom has it in his notes: titles on their own lines, then the text. */
const notes = report.map(([heading, , body]) => (body ? `${heading}\n${body}` : heading)).join("\n\n");

test("04-long-report-with-outline-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Tom has the garden's annual report in his notes and asks the assistant to lay it out.");
  const run = await askAgent(
    page,
    "Please turn my report below into a new document called Community garden annual report, with the section titles as proper headings. Spring planting and Summer harvest are sub-sections of Growing season, and Income and Expenses are sub-sections of Budget.",
    { paste: `\n\n${notes}` },
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const editor = page.getByRole("textbox", { name: "Document content" });
  const outline = page.locator(".outline");
  await expect(page.getByLabel("File title"), why).toHaveValue("Community garden annual report");
  await expect(outline.locator(".outline-item"), why).toHaveText(report.map(([heading]) => heading));
  await expect(outline.locator(".outline-item.level-2"), why).toHaveText(
    report.filter(([, style]) => style === "Heading 2").map(([heading]) => heading),
  );
  for (const [heading, style] of report)
    await expect(editor.locator(style === "Heading 1" ? "h1" : "h2").filter({ hasText: heading }), why).toHaveCount(1);
  for (const [, , body] of report) if (body) await expect(editor, why).toContainText(body);
  await expect(page.locator(".editor-status"), why).toContainText(/[2-9] pages/);
  await caption(page, "Five sections and four sub-sections, over two pages. The outline on the left lists them all.", 2200);

  await caption(page, "Now he wants to thank the volunteers.", 900);
  const thanks = "A special thank-you to the Saturday tea rota!";
  const second = await askAgent(
    page,
    `Take me to the Volunteers section and add this line right under its heading: ${thanks}`,
  );
  const why2 = describeRun(second);
  expect(second.state, why2).toBe("done");
  const volunteers = editor.getByRole("heading", { name: "Volunteers", exact: true });
  await expect(volunteers, why2).toBeInViewport();
  await expect(outline.locator("[aria-current=location]"), why2).toHaveText("Volunteers");
  await expect(volunteers.locator("xpath=following-sibling::*[1]"), why2).toHaveText(thanks);
  await expect(volunteers.locator("xpath=following-sibling::*[1]"), why2).toHaveJSProperty("tagName", "P");
  await expect(editor, why2).toContainText(report[4][2]!);
  await expect(outline.locator(".outline-item"), why2).toHaveCount(report.length);
  await expect(page.getByRole("status"), why2).toContainText("Saved");
  await caption(page, "Gemma jumped to Volunteers with the outline and added the thank-you under the heading. It saved itself.", 2200);
  await beat(page, 600);
});

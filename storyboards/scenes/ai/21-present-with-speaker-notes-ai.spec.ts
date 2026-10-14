import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";
import { gardenDeck } from "../fixtures";

/**
 * Real fullscreen resizes the recording window, so stand in for the
 * Fullscreen API (as the original storyboard does) and check the calls instead.
 */
function stubFullscreen() {
  const w = window as unknown as { __fullscreenStub?: boolean };
  if (w.__fullscreenStub) return;
  w.__fullscreenStub = true;
  let current: Element | null = null;
  const change = (el: Element | null) => {
    current = el;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };
  Object.defineProperty(document, "fullscreenElement", { get: () => current, configurable: true });
  Element.prototype.requestFullscreen = function () {
    return change(this);
  };
  document.exitFullscreen = () => change(null);
}

interface ShowFrame {
  counter: string;
  notes: string | null;
  fullscreen: boolean;
}

/** Notes what the slide show displays as it changes: slide counter, notes panel, full screen. */
function watchShow() {
  const log: (ShowFrame | { ended: true; fullscreen: boolean })[] = [];
  (window as unknown as { __showLog: typeof log }).__showLog = log;
  let showing = false;
  let last = "";
  setInterval(() => {
    const show = document.querySelector(".presenter-overlay");
    if (!show) {
      if (showing) log.push({ ended: true, fullscreen: document.fullscreenElement !== null });
      showing = false;
      last = "";
      return;
    }
    showing = true;
    const frame: ShowFrame = {
      counter: show.querySelector(".presenter-counter")?.textContent?.trim() ?? "",
      notes: show.querySelector(".presenter-notes-text")?.textContent?.trim() ?? null,
      fullscreen: document.fullscreenElement !== null,
    };
    const key = JSON.stringify(frame);
    if (key !== last) log.push(frame);
    last = key;
  }, 100);
}

const NOTES = [
  "Welcome everyone. Thank the library for the room.",
  "Mention the compost delivery on Friday.",
  "Pass the sign-up sheet around now.",
];

test("21-present-with-speaker-notes-ai", async ({ page }) => {
  await page.addInitScript(stubFullscreen);
  await openApp(page);
  await page.evaluate(stubFullscreen);
  await caption(page, "It's Saturday morning. Priya is presenting the garden kickoff slides she saved last night.");
  await caption(page, "She's nervous about forgetting things, so she asks the assistant to add a reminder under each slide.", 1800);
  await caption(page, "", 0);

  const prepare = await askAgent(
    page,
    "Open the Spring Garden Kickoff slides I saved last night and add speaker notes to the first three slides. " +
      `Slide 1: ${NOTES[0]} Slide 2: ${NOTES[1]} Slide 3: ${NOTES[2]}`,
    {
      files: [
        { name: "Spring Garden Kickoff.slslides", mimeType: "application/json", buffer: Buffer.from(gardenDeck()) },
      ],
    },
  );
  let why = describeRun(prepare);
  expect(prepare.state, why).toBe("done");
  const rows = page.locator(".thumbnail-row");
  await expect(page.getByLabel("File title"), why).toHaveValue("Spring Garden Kickoff");
  await expect(rows, why).toHaveCount(4);
  await caption(page, "The deck is open, and each of the first three slides has its note.", 2000);

  await caption(page, "Time for a run-through. She wants to see her notes as she goes.");
  await caption(page, "", 0);
  await page.evaluate(watchShow);
  const rehearse = await askAgent(
    page,
    "Let's rehearse. Start the slideshow from the beginning with my notes showing, go through the slides until Questions?, then end the show.",
  );
  // The session keeps the first request's transcript, so this covers both.
  why = describeRun(rehearse);
  expect(rehearse.state, why).toBe("done");
  const log = await page.evaluate(() => (window as unknown as { __showLog: unknown[] }).__showLog);
  const listing = `${why}\nShow: ${JSON.stringify(log)}`;
  const frames = log.filter((f): f is ShowFrame => !("ended" in (f as object)));

  // The show starts in full screen on slide 1, with that slide's notes beside it.
  expect(frames[0], listing).toMatchObject({ counter: "Slide 1 of 4", notes: NOTES[0], fullscreen: true });
  // Each of slides 1–3 was shown with its own note, and the show reached the last slide.
  for (const [i, note] of NOTES.entries())
    expect(frames.some((f) => f.counter === `Slide ${i + 1} of 4` && f.notes === note), listing).toBe(true);
  expect(frames.some((f) => f.counter === "Slide 4 of 4"), listing).toBe(true);
  // Then it ended and left full screen.
  expect(log.at(-1), listing).toEqual({ ended: true, fullscreen: false });
  await expect(page.locator(".presenter-overlay"), listing).toHaveCount(0);
  await caption(page, "The show ended and left full screen. Back in the editor, she checks her notes.", 1600);

  const notes = page.getByPlaceholder("Click to add speaker notes");
  for (const [i, note] of NOTES.entries()) {
    await rows.nth(i).click();
    await expect(notes, listing).toHaveValue(note);
    await beat(page, 1000);
  }
  await rows.nth(3).click();
  await expect(notes, listing).toHaveValue("");
  await beat(page, 600);
  await rows.nth(0).click();
  await caption(page, "Her notes stay with each slide and save with the presentation.", 2000);
});

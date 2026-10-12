import type { Locator, Page } from "@playwright/test";
import {
  beat,
  caption,
  clusterReady,
  expect,
  startServer,
  test,
  typeSlowly,
} from "./harness";

const password = "garden-party-2026";

/** Replace everything in a slide text box, typing like a person. */
async function retype(page: Page, box: Locator, text: string) {
  await box.click();
  await box.press("ControlOrMeta+A");
  await typeSlowly(page, text);
}

/** Drag an element on the slide by an offset in screen pixels. */
async function drag(page: Page, target: Locator, dx: number, dy: number) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 25 });
  await page.mouse.up();
}

/** Put the caret after the last character of a document and type there. */
async function typeAtEnd(page: Page, editor: Locator, text: string) {
  const line = (await editor.locator("p").last().boundingBox())!;
  await page.mouse.click(line.x + line.width - 4, line.y + line.height / 2);
  await typeSlowly(page, text);
}

/** Scroll the home screen so the SuiteDrive file list is in view. */
async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await beat(page, 700);
}

/** Click a blank part of the slide so slide-level tools (Background) show. */
async function clickSlideBackground(page: Page) {
  const canvas = page.locator(".slide-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.04, box.y + box.height * 0.94);
}

async function createAccount(page: Page, name: string, email: string) {
  const card = page.getByLabel("Sign in to SuiteLeaf");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Create an account" }).click();
  await card.getByLabel("Name", { exact: true }).click();
  await typeSlowly(page, name);
  await card.getByLabel("Email", { exact: true }).click();
  await typeSlowly(page, email);
  await card.getByLabel("Password", { exact: true }).click();
  await typeSlowly(page, password, 20);
  await card.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function signIn(page: Page, email: string) {
  const card = page.getByLabel("Sign in to SuiteLeaf");
  await expect(card).toBeVisible();
  await card.getByLabel("Email or username", { exact: true }).click();
  await typeSlowly(page, email);
  await card.getByLabel("Password", { exact: true }).click();
  await typeSlowly(page, password, 20);
  await card.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

const driveItem = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/** A small finished deck, as a downloaded SuiteLeaf presentation file. */
function gardenDeck() {
  const now = new Date().toISOString();
  const text = (content: string, y: number, extra: object = {}) => ({
    id: crypto.randomUUID(),
    type: "text",
    x: 80,
    y,
    width: 800,
    height: 70,
    content,
    fontSize: 34,
    bold: true,
    color: "#0f172a",
    ...extra,
  });
  const body = (content: string) =>
    text(content, 150, {
      height: 320,
      fontSize: 22,
      bold: false,
      color: "#334155",
    });
  const slides = [
    {
      title: "Spring Garden Kickoff",
      layout: "title",
      background: { color: "#e2ece9" },
      elements: [
        text("Spring Garden Kickoff", 170, { fontSize: 44, align: "center" }),
        text("Community Garden · Saturday 10 am", 280, {
          fontSize: 22,
          bold: false,
          align: "center",
          color: "#475569",
        }),
      ],
    },
    {
      title: "This season's plan",
      layout: "title-body",
      elements: [
        text("This season's plan", 50),
        body("• Tomatoes and basil in the sunny beds\n• New compost bins by the shed\n• Watering rota on the noticeboard"),
      ],
    },
    {
      title: "How you can help",
      layout: "title-body",
      elements: [
        text("How you can help", 50),
        body("• Saturday work parties, 9–11 am\n• Seedling swap in May\n• Sign up at the shed door"),
      ],
    },
    {
      title: "Questions?",
      layout: "section",
      background: { color: "#1e293b" },
      elements: [
        text("Questions?", 200, {
          height: 120,
          fontSize: 46,
          align: "center",
          color: "#f8fafc",
        }),
      ],
    },
  ].map((s) => ({ id: crypto.randomUUID(), notes: "", ...s }));
  const id = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Spring Garden Kickoff",
    createdAt: now,
    updatedAt: now,
    kind: "slide",
    content: {
      id,
      width: 960,
      height: 540,
      slideOrder: slides.map((s) => s.id),
      slides: Object.fromEntries(slides.map((s) => [s.id, s])),
    },
  });
}

test("20-build-a-presentation", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Priya is making slides for Saturday's community garden meeting.");
  await caption(page, "She starts a new presentation.", 900);
  await page.getByRole("button", { name: "New presentation" }).click();

  const title = page.getByLabel("File title");
  await expect(title).toHaveValue("Untitled presentation");
  await caption(page, "First, name the file.", 900);
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Spring Garden Kickoff");

  const boxes = page.locator(".slide-canvas .slide-element textarea");
  const rows = page.locator(".thumbnail-row");
  await expect(boxes.nth(0)).toHaveAttribute("placeholder", "Click to add title");
  await expect(boxes.nth(0)).toHaveValue("");
  await caption(page, "The title slide has empty placeholders. Click one and type.", 1200);
  await boxes.nth(0).click();
  await typeSlowly(page, "Spring Garden Kickoff");
  await boxes.nth(1).click();
  await typeSlowly(page, "Community Garden · Saturday 10 am");

  await caption(page, "Add a slide with a title and bullet points.", 900);
  await page.getByRole("button", { name: "+ New slide" }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Title & body" }).click();
  await expect(rows).toHaveCount(2);
  await beat(page, 600);
  await boxes.nth(0).click();
  await typeSlowly(page, "This season's plan");
  await boxes.nth(1).click();
  await typeSlowly(
    page,
    "• Tomatoes and basil in the sunny beds\n• New compost bins by the shed\n• Watering rota on the noticeboard",
  );

  await caption(page, "Another slide for the volunteer jobs.", 900);
  await page.getByRole("button", { name: "+ New slide" }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Title & body" }).click();
  await boxes.nth(0).click();
  await typeSlowly(page, "How you can help");

  await caption(page, "Two lists side by side would read better. Change the layout.", 1100);
  await clickSlideBackground(page);
  await page.getByRole("button", { name: "Layout" }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Two columns" }).click();
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).toHaveValue("How you can help");
  await beat(page, 700);
  await boxes.nth(1).click();
  await typeSlowly(page, "Saturdays\n• Weeding, 9–11 am\n• Watering rota");
  await boxes.nth(2).click();
  await typeSlowly(page, "In May\n• Seedling swap\n• Plant sale stall");

  await caption(page, "A section header to close. It comes with a dark background.", 900);
  await page.getByRole("button", { name: "+ New slide" }).click();
  await beat(page, 500);
  await page.getByRole("menuitem", { name: "Section header" }).click();
  await boxes.nth(0).click();
  await typeSlowly(page, "Questions?");
  await expect(rows).toHaveCount(4);

  await caption(page, "Back on the title slide, add a shape: a yellow sun in the corner.", 900);
  await rows.nth(0).click();
  await page.getByRole("button", { name: "Circle" }).click();
  const shape = page.locator(".slide-canvas .slide-shape");
  await expect(shape).toBeVisible();
  await page.getByRole("button", { name: "Fill", exact: true }).click();
  await page.getByRole("menuitem", { name: "Yellow", exact: true }).click();
  const canvas = (await page.locator(".slide-canvas").boundingBox())!;
  const scale = canvas.width / 960;
  await drag(page, shape, 630 * scale, -135 * scale);
  await beat(page, 600);

  await caption(page, "Give the title slide a soft green background.", 900);
  await clickSlideBackground(page);
  await page.getByRole("button", { name: "Background" }).click();
  await page.getByRole("menuitem", { name: "Sage green" }).click();
  await expect(page.locator(".slide-canvas")).toHaveCSS(
    "background-color",
    "rgb(226, 236, 233)",
  );
  await beat(page);

  await caption(page, "The volunteer slide should come first. Drag its thumbnail up.", 1200);
  const from = (await rows.nth(2).boundingBox())!;
  const to = (await rows.nth(1).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 6, { steps: 30 });
  await beat(page, 700);
  await page.mouse.up();
  await expect(rows.nth(1)).toContainText("How you can help");
  await expect(rows.nth(2)).toContainText("This season's plan");
  await beat(page);

  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "Four slides, saved on this device as she goes.", 1800);
});

test("21-present-with-speaker-notes", async ({ page }) => {
  // Real fullscreen resizes the headless window and ruins the recording, so
  // stand in for the Fullscreen API and check the calls instead of pixels.
  await page.addInitScript(() => {
    let current: Element | null = null;
    const change = (el: Element | null) => {
      current = el;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    Object.defineProperty(document, "fullscreenElement", { get: () => current });
    Element.prototype.requestFullscreen = function () {
      return change(this);
    };
    document.exitFullscreen = () => change(null);
  });
  const fullscreen = () => page.evaluate(() => document.fullscreenElement !== null);
  await page.goto("/");
  await caption(page, "It's Saturday. Priya opens the slides she saved last night.");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles({
    name: "Spring Garden Kickoff.slslides",
    mimeType: "application/json",
    buffer: Buffer.from(gardenDeck()),
  });
  await expect(page.getByLabel("File title")).toHaveValue("Spring Garden Kickoff");
  await expect(page.locator(".thumbnail-row")).toHaveCount(4);

  const notes = page.getByPlaceholder("Click to add speaker notes");
  await caption(page, "Under each slide is a box for speaker notes, only for her.", 1200);
  await notes.click();
  await typeSlowly(page, "Welcome everyone. Thank the library for the room.");
  await beat(page, 500);
  await caption(page, "She adds a reminder to each slide.", 700);
  await page.locator(".thumbnail-row").nth(1).click();
  await notes.click();
  await typeSlowly(page, "Mention the compost delivery on Friday.");
  await beat(page, 500);
  await page.locator(".thumbnail-row").nth(2).click();
  await notes.click();
  await typeSlowly(page, "Pass the sign-up sheet around now.");
  await expect(notes).toHaveValue("Pass the sign-up sheet around now.");
  await beat(page);

  await caption(page, "Time for a run-through. The arrow next to Slideshow has more ways to start.", 1200);
  await page.getByRole("button", { name: "Slideshow options" }).click();
  const fromStart = page.getByRole("menuitem", { name: /Present from beginning/ });
  await expect(fromStart).toBeVisible();
  await caption(page, "She's on slide 3, but picks Present from beginning.", 1600);
  await fromStart.click();
  const show = page.locator(".presenter-overlay");
  await expect(show).toBeVisible();
  await expect(show).toContainText("Spring Garden Kickoff");
  await expect.poll(fullscreen).toBe(true);
  await caption(page, "The show opens in full screen, starting on slide 1.", 1800);
  await expect(show.locator(".presenter-controls")).toHaveClass(/hidden/);

  const notesPanel = show.getByRole("complementary", { name: "Speaker notes" });
  await caption(page, "She presses S to see her notes beside the slide, with a timer and what's next.", 900);
  await page.keyboard.press("s");
  await expect(notesPanel).toContainText("Welcome everyone. Thank the library for the room.");
  await expect(notesPanel).toContainText("Next: This season's plan");
  await beat(page, 2200);

  await caption(page, "The right arrow key moves on. The notes follow the slide.", 900);
  await page.keyboard.press("ArrowRight");
  await expect(show).toContainText("This season's plan");
  await expect(notesPanel).toContainText("Mention the compost delivery on Friday.");
  await beat(page, 1800);
  await page.keyboard.press("ArrowRight");
  await expect(notesPanel).toContainText("Pass the sign-up sheet around now.");
  await beat(page, 1800);

  await caption(page, "Ready. S again hides the notes, so the slide fills the screen.", 900);
  await page.keyboard.press("s");
  await expect(notesPanel).toHaveCount(0);
  await beat(page, 1200);

  await caption(page, "The mouse brings back the controls.", 900);
  await page.mouse.move(640, 700, { steps: 10 });
  await expect(show.getByText("Slide 3 of 4")).toBeVisible();
  await expect(show.getByRole("button", { name: "Notes" })).toBeVisible();
  await beat(page, 700);
  await show.getByRole("button", { name: "Next" }).click();
  await expect(show).toContainText("Questions?");
  await expect(show.getByText("Slide 4 of 4")).toBeVisible();
  await beat(page, 1400);

  await caption(page, "Escape ends the show.", 1000);
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);
  await expect.poll(fullscreen).toBe(false);
  await page.locator(".thumbnail-row").nth(0).click();
  await expect(notes).toHaveValue("Welcome everyone. Thank the library for the room.");
  await caption(page, "Her notes stay with each slide and save with the presentation.", 2000);
});

test.describe("cluster mode", () => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

  test("22-connect-to-your-team-server", async ({ page }) => {
    await page.goto("/");
    const server = await startServer(undefined, [new URL(page.url()).origin]);
    try {
      await expect(page.getByText("Your workspace, in this browser.")).toBeVisible();
      await caption(page, "Leo has used SuiteLeaf on his own. Now his team has a SuiteLeaf server.");
      await caption(page, "In the sidebar: Connect to a server.", 900);
      await page.getByRole("button", { name: "Connect to a server" }).click();

      const dialog = page.getByRole("dialog", { name: "Connect to a SuiteLeaf server" });
      await expect(dialog).toBeVisible();
      await caption(page, "He types the address his team gave him.", 900);
      await dialog.getByLabel("Server address").click();
      await typeSlowly(page, server.url);
      await beat(page, 500);
      await dialog.getByRole("button", { name: "Connect", exact: true }).click();

      const card = page.getByLabel("Sign in to SuiteLeaf");
      await expect(card).toBeVisible();
      await expect(card).toContainText(new URL(server.url).host);
      await caption(page, "The server asks him to sign in. It's his first time, so he creates an account.", 1600);
      await createAccount(page, "Leo Martins", "leo@riverside-garden.org");

      await expect(page.getByRole("heading", { name: "SuiteDrive" })).toBeVisible();
      await caption(page, "He lands on the team home screen.", 1200);
      await showDrive(page);
      await expect(page.getByText("This folder is empty.")).toBeVisible();
      await expect(page.getByText("Leo Martins")).toBeVisible();
      await caption(page, "Below is SuiteDrive, the team's shared drive. Files he makes here live on the server.", 2400);
      await expect(page.getByText("Connect to a server")).toHaveCount(0);
      await caption(page, "His name and the server are in the sidebar.", 1800);
    } finally {
      server.stop();
    }
  });

  test("23-start-a-document-in-suitedrive", async ({ page }) => {
    const server = await startServer();
    try {
      await page.goto(server.url);
      await caption(page, "Rosa opens her team's SuiteLeaf server in the browser.");
      await createAccount(page, "Rosa Diaz", "rosa@riverside-garden.org");
      await expect(page.getByRole("heading", { name: "SuiteDrive" })).toBeVisible();
      await showDrive(page);

      await caption(page, "She makes a folder for the garden club. (SuiteLeaf asks for the name.)", 1400);
      page.once("dialog", (d) => void d.accept("Garden club"));
      await page.getByRole("button", { name: "New folder" }).click();
      await expect(driveItem(page, "Garden club")).toBeVisible();
      await beat(page);

      await caption(page, "She opens the folder…", 900);
      await driveItem(page, "Garden club").click();
      await expect(page.getByLabel("Folder path")).toContainText("Garden club");
      await expect(page.getByText("This folder is empty.")).toBeVisible();
      await beat(page, 600);
      await caption(page, "…and starts a new document inside it.", 900);
      await page.getByRole("button", { name: "New document" }).click();

      const editor = page.getByRole("textbox", { name: "Document content" });
      await expect(editor).toBeVisible();
      await editor.click();
      await typeSlowly(page, "Watering rota: Mon Rosa, Tue Leo, Wed Priya, Thu Sam.");
      const status = page.getByRole("status");
      await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await caption(page, "There's no Save button. The status says \"Saved to SuiteDrive\".", 1800);

      await caption(page, "To rename it, she types a new title.", 900);
      const title = page.getByLabel("File title");
      await title.click();
      await title.press("ControlOrMeta+A");
      await typeSlowly(page, "Watering rota");
      await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await beat(page);

      await caption(page, "Back in SuiteDrive, she opens the folder again.", 1000);
      await page.getByRole("button", { name: "Back to files" }).click();
      await showDrive(page);
      await driveItem(page, "Garden club").click();
      await expect(driveItem(page, "Watering rota.sldoc")).toBeVisible();
      await caption(page, "The document is there under its new name, ready for the rest of the team.", 2200);
    } finally {
      server.stop();
    }
  });

  test("24-pick-up-on-another-server", async ({ page }) => {
    const office = await startServer();
    const library = await startServer({ dataDir: office.dataDir, p2p: office.p2p });
    try {
      await page.goto(office.url);
      await caption(page, `Priya works on her talk at the office, on server ${new URL(office.url).host}.`);
      await createAccount(page, "Priya Shah", "priya@riverside-garden.org");
      await page.getByRole("button", { name: "New presentation" }).click();
      const title = page.getByLabel("File title");
      await title.click();
      await title.press("ControlOrMeta+A");
      await typeSlowly(page, "Budget update");
      const boxes = page.locator(".slide-canvas .slide-element textarea");
      await retype(page, boxes.nth(0), "Budget update");
      await retype(page, boxes.nth(1), "Seeds $120 · Tools $85 · Compost $60");
      await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await caption(page, "Saved to SuiteDrive. She heads home.", 1400);

      const heads = async (url: string) =>
        (await (await fetch(`${url}/api/node/info`)).json()).suitedb.heads.join();
      await expect
        .poll(async () => (await heads(office.url)) === (await heads(library.url)), { timeout: 30000 })
        .toBe(true);
      await expect
        .poll(
          async () =>
            (await (await fetch(`${library.url}/api/node/info`)).json()).suitedrive.replicating,
          { timeout: 30000 },
        )
        .toBe(0);

      await page.goto(library.url);
      await caption(page, `That evening she opens the team's other server, ${new URL(library.url).host}.`, 1600);
      await caption(page, "It's a new address, so she signs in. Her account is already there.", 1200);
      await signIn(page, "priya@riverside-garden.org");
      await expect(page.getByText(new URL(library.url).host).first()).toBeVisible();

      await showDrive(page);
      await expect(driveItem(page, "Budget update.slslides")).toBeVisible();
      await caption(page, "So is her presentation.", 1400);
      await driveItem(page, "Budget update.slslides").click();
      await expect(page.locator(".slide-canvas")).toContainText("Seeds $120");
      await caption(page, "She picks up where she left off.", 900);
      const subtitle = page.locator(".slide-canvas .slide-element textarea").nth(1);
      await subtitle.click();
      await subtitle.evaluate((el: HTMLTextAreaElement) =>
        el.setSelectionRange(el.value.length, el.value.length),
      );
      await typeSlowly(page, " · Hoses $40");
      await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await caption(page, "Every server in the cluster keeps a full copy of accounts and files.", 2000);
    } finally {
      library.stop();
      office.stop();
    }
  });

  test("25-when-someone-else-saved-first", async ({ page }) => {
    const server = await startServer();
    try {
      await page.goto(server.url);
      await caption(page, "Sam is writing the bake sale flyer in SuiteDrive.");
      await createAccount(page, "Sam Okafor", "sam@riverside-garden.org");
      await page.getByRole("button", { name: "New document" }).click();
      const title = page.getByLabel("File title");
      await title.click();
      await title.press("ControlOrMeta+A");
      await typeSlowly(page, "Bake sale flyer");
      const editor = page.getByRole("textbox", { name: "Document content" });
      await editor.click();
      await typeSlowly(page, "Bake sale on Saturday, 10 am to noon.");
      const status = page.getByRole("status");
      await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

      /** Save a new version of a file the way another person's app would. */
      const saveElsewhere = (name: string, from: string, to: string) =>
        page.evaluate(
          async ([name, from, to]) => {
            const s = JSON.parse(localStorage.getItem("suiteleaf:node-session")!);
            const headers = { authorization: `Bearer ${s.token}` };
            const { items } = await (await fetch(`${s.url}/api/drive/items`, { headers })).json();
            const id = items.find((i: { name: string }) => i.name === name).id;
            const url = `${s.url}/api/drive/items/${id}/content`;
            const text = await (await fetch(url, { headers })).text();
            const r = await fetch(url, {
              method: "PUT",
              headers: { ...headers, "content-type": "application/json" },
              body: text.replace(from, to),
            });
            if (!r.ok) throw new Error(`upload failed: ${r.status}`);
          },
          [name, from, to],
        );

      await caption(page, "Meanwhile, Jordan changes the time on their own computer and saves.", 1600);
      await saveElsewhere("Bake sale flyer.sldoc", "10 am to noon", "9 am to 1 pm");
      await caption(page, "Sam doesn't know yet, and keeps typing.", 900);
      await typeAtEnd(page, editor, " All proceeds go to new raised beds.");

      const banner = page.getByText("This file was changed in SuiteDrive after you opened it");
      await expect(banner).toBeVisible({ timeout: 20000 });
      await expect(status).toHaveText("SuiteDrive has a newer version");
      await caption(page, "SuiteLeaf won't overwrite Jordan's version. Sam's edits are safe on this device.", 2200);

      await caption(page, "Sam keeps both: Save as copy.", 1000);
      await page.getByRole("button", { name: "Save as copy" }).click();
      await expect(status).toHaveText("Saved a copy to SuiteDrive");
      await expect(banner).toHaveCount(0);
      await beat(page);

      await caption(page, "The copy has the same name as the original, so Sam renames it.", 1400);
      await title.click();
      await title.press("ControlOrMeta+A");
      await typeSlowly(page, "Bake sale flyer (Sam's draft)");
      await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

      await page.getByRole("button", { name: "Back to files" }).click();
      await showDrive(page);
      const items = page.locator(".drive-list .drive-item");
      await expect(items).toHaveCount(2);
      await expect(driveItem(page, "Bake sale flyer (Sam's draft).sldoc")).toBeVisible();
      await caption(page, "SuiteDrive now has Jordan's version and Sam's copy.", 2000);

      await caption(page, "Sam opens Jordan's version to compare.", 1000);
      const jordans = driveItem(page, "Bake sale flyer.sldoc");
      await jordans.click();
      await expect(editor).toContainText("9 am to 1 pm");
      await beat(page, 1200);

      await caption(page, "While Sam adds a line, Jordan saves again first.", 1200);
      await saveElsewhere("Bake sale flyer.sldoc", "Saturday", "Saturday 14 June");
      await typeAtEnd(page, editor, " Bring a cake!");
      await expect(banner).toBeVisible({ timeout: 20000 });
      await caption(page, "This time Jordan's version is the one to keep: Reload from SuiteDrive.", 1600);
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: "Reload from SuiteDrive" }).click();
      await expect(editor).toContainText("Saturday 14 June");
      await expect(editor).not.toContainText("Bring a cake!");
      await expect(status).toHaveText("Saved to SuiteDrive");
      await caption(page, "Nothing was overwritten without Sam choosing.", 1800);
    } finally {
      server.stop();
    }
  });

  test("26-sign-out-and-disconnect", async ({ page }) => {
    await page.goto("/");
    const server = await startServer(undefined, [new URL(page.url()).origin]);
    try {
      await caption(page, "Leo keeps a personal to-do list on this computer.");
      await page.getByRole("button", { name: "New document" }).click();
      await page.getByLabel("File title").fill("Personal to-do");
      await page.getByRole("textbox", { name: "Document content" }).click();
      await typeSlowly(page, "Renew library card. Buy tomato stakes.");
      await expect(page.getByRole("status")).toHaveText("Saved on this device");
      await page.getByRole("button", { name: "Back to files" }).click();

      await caption(page, "He connects to the team server to work on shared files.", 1000);
      await page.getByRole("button", { name: "Connect to a server" }).click();
      const dialog = page.getByRole("dialog", { name: "Connect to a SuiteLeaf server" });
      await dialog.getByLabel("Server address").fill(server.url);
      await dialog.getByRole("button", { name: "Connect", exact: true }).click();
      await createAccount(page, "Leo Martins", "leo@riverside-garden.org");
      await page.getByRole("button", { name: "New document" }).click();
      await page.getByLabel("File title").fill("Shed inventory");
      await page.getByRole("textbox", { name: "Document content" }).click();
      await typeSlowly(page, "3 spades, 2 rakes, 1 wheelbarrow.");
      await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
      await page.getByRole("button", { name: "Back to files" }).click();
      await showDrive(page);
      await expect(driveItem(page, "Shed inventory.sldoc")).toBeVisible();
      await caption(page, "SuiteDrive shows the team's files. His personal list isn't mixed in.", 1600);
      await expect(page.getByText("Personal to-do")).toHaveCount(0);

      await caption(page, "Done for the day: Sign out, next to his name.", 1000);
      await page.getByRole("button", { name: "Sign out" }).click();
      const card = page.getByLabel("Sign in to SuiteLeaf");
      await expect(card).toBeVisible();
      await caption(page, "The server's files are now behind the sign-in page.", 1400);

      await caption(page, "To go back to working on this computer only, he leaves the server.", 1200);
      await card.getByRole("button", { name: "Work on this computer without a server" }).click();
      await expect(page.getByText("Your workspace, in this browser.")).toBeVisible();
      await page
        .getByRole("heading", { name: "Your files" })
        .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
      await beat(page, 700);
      await expect(page.getByRole("link", { name: /Personal to-do/ })).toBeVisible();
      await expect(page.getByText("Shed inventory")).toHaveCount(0);
      await caption(page, "His personal list is right where he left it. Shed inventory stays on the server.", 2200);
    } finally {
      server.stop();
    }
  });
});

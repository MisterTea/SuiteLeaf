import { expect, it } from "vitest";
import { audienceLines, audienceScreenDocument, openAudienceScreen } from "../apps/web/src/editors/audience-screen";

it("writes the visible slide text and leaves speaker notes off the audience screen", () => {
  const notes = "secret-value";
  const lines = audienceLines([
    { type: "text", content: "Welcome\nNorth beds" },
    { type: "shape", content: "Beds" },
    { type: "table", rows: [["Plot", " "], ["North", "10"]] },
    { type: "image", alt: "Tomato" },
    { type: "text", content: "  " },
  ]);
  expect(lines).toEqual(["Welcome", "North beds", "Beds", "Plot", "North", "10", "Tomato"]);
  expect(lines.join(" ")).not.toContain(notes);
  const shown = audienceScreenDocument({ slideIndex: 0, blank: false }, lines);
  expect(shown).toContain("<h1>Welcome</h1>");
  expect(shown).toContain("<p>North beds</p>");
  expect(shown).toContain("<p>Tomato</p>");
  expect(shown).not.toContain(notes);
  const blank = audienceScreenDocument({ slideIndex: 2, blank: true }, lines);
  expect(blank).toContain("<h1>The screen is blank.</h1>");
  expect(blank).not.toContain("Welcome");
  expect(blank).not.toContain("Tomato");
  const written: string[] = [];
  expect(
    openAudienceScreen(
      {
        document: {
          open() {},
          write(html: string) {
            written.push(html);
          },
          close() {},
        },
      },
      { slideIndex: 1, blank: false },
      [],
    ),
  ).toBe(true);
  expect(written[0]).toContain("<h1>Slide 2</h1>");
  expect(written[0]).not.toContain(notes);
  expect(openAudienceScreen(null, { slideIndex: 0, blank: false }, lines)).toBe(false);
});

it("replaces the audience window when the show moves to the next slide", () => {
  let html = "";
  const popup = {
    document: {
      open() {},
      write(next: string) {
        html = next;
      },
      close() {},
    },
  };
  openAudienceScreen(popup, { slideIndex: 0, blank: false }, ["Welcome"]);
  expect(html).toContain("<h1>Welcome</h1>");
  openAudienceScreen(popup, { slideIndex: 1, blank: false }, ["North beds"]);
  expect(html).toContain("<h1>North beds</h1>");
  expect(html).not.toContain("Welcome");
  openAudienceScreen(popup, { slideIndex: 1, blank: true }, ["secret-value"]);
  expect(html).toContain("The screen is blank.");
  expect(html).not.toContain("secret-value");
  expect(html).not.toContain("North beds");
});

it("leaves an unrevealed click animation off the audience screen", () => {
  const elements = [
    { id: "title", type: "text", content: "Welcome" },
    { id: "later", type: "text", content: "secret-value", animation: "fade-on-click" },
  ];
  const waiting = audienceLines(elements, 0);
  expect(waiting).toEqual(["Welcome"]);
  expect(waiting.join(" ")).not.toContain("secret-value");
  const shown = audienceScreenDocument({ slideIndex: 0, blank: false }, waiting);
  expect(shown).not.toContain("secret-value");
  expect(audienceLines(elements, 1)).toEqual(["Welcome", "secret-value"]);
});

it("uses master title text on a blank audience title and keeps typed words", () => {
  const master = [{ id: "master-title", placeholder: "title", content: "Garden club" }];
  const blank = audienceLines(
    [{ id: "box", type: "text", placeholder: "title", content: "" }],
    undefined,
    master,
  );
  expect(blank).toEqual(["Garden club"]);
  const typed = audienceLines(
    [{ id: "box", type: "text", placeholder: "title", content: "North" }],
    undefined,
    [{ id: "master-title", placeholder: "title", content: "secret-value" }],
  );
  expect(typed).toEqual(["North"]);
  expect(typed.join(" ")).not.toContain("secret-value");
});

it("leaves a decorative object off the audience screen", () => {
  const decorative = { id: "mark", type: "text" as const, content: "secret-value", decorative: true };
  const lines = audienceLines([
    decorative,
    { id: "title", type: "text", content: "North" },
    { id: "photo", type: "image", alt: "secret-value", decorative: true },
  ]);
  expect(lines).toEqual(["North"]);
  expect(lines.join(" ")).not.toContain("secret-value");
  expect(decorative.content).toBe("secret-value");
});

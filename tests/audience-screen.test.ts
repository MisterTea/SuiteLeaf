import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  audienceLines,
  audienceScreenDocument,
  openAudienceScreen,
} from "../apps/web/src/editors/audience-screen";

const documents: Blob[] = [];
beforeEach(() => {
  documents.length = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    documents.push(blob as Blob);
    return `blob:audience-${documents.length}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("writes the visible slide text and leaves speaker notes off the audience screen", async () => {
  const notes = "secret-value";
  const lines = audienceLines([
    { type: "text", content: "Welcome\nNorth beds" },
    { type: "shape", content: "Beds" },
    {
      type: "table",
      rows: [
        ["Plot", " "],
        ["North", "10"],
      ],
    },
    { type: "image", alt: "Tomato" },
    { type: "text", content: "  " },
  ]);
  expect(lines).toEqual([
    "Welcome",
    "North beds",
    "Beds",
    "Plot",
    "North",
    "10",
    "Tomato",
  ]);
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
  const replace = vi.fn();
  expect(
    openAudienceScreen(
      {
        location: { replace },
      },
      { slideIndex: 1, blank: false },
      [],
    ),
  ).toBe(true);
  expect(replace).toHaveBeenCalledWith("blob:audience-1");
  expect(await documents[0]!.text()).toContain("<h1>Slide 2</h1>");
  expect(await documents[0]!.text()).not.toContain(notes);
  expect(openAudienceScreen(null, { slideIndex: 0, blank: false }, lines)).toBe(
    false,
  );
});

it("replaces the audience window when the show moves to the next slide", async () => {
  const popup = {
    location: { replace: vi.fn() },
  };
  openAudienceScreen(popup, { slideIndex: 0, blank: false }, ["Welcome"]);
  let html = await documents.at(-1)!.text();
  expect(html).toContain("<h1>Welcome</h1>");
  openAudienceScreen(popup, { slideIndex: 1, blank: false }, ["North beds"]);
  html = await documents.at(-1)!.text();
  expect(html).toContain("<h1>North beds</h1>");
  expect(html).not.toContain("Welcome");
  openAudienceScreen(popup, { slideIndex: 1, blank: true }, ["secret-value"]);
  html = await documents.at(-1)!.text();
  expect(html).toContain("The screen is blank.");
  expect(html).not.toContain("secret-value");
  expect(html).not.toContain("North beds");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audience-1");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audience-2");
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:audience-3");
});

it("handles closed windows and navigation errors without throwing", () => {
  expect(
    openAudienceScreen(
      { closed: true, location: { replace: vi.fn() } },
      { slideIndex: 0, blank: false },
      [],
    ),
  ).toBe(false);
  const popup = {
    location: {
      replace: vi.fn(() => {
        throw new Error("Navigation blocked");
      }),
    },
  };
  expect(openAudienceScreen(popup, { slideIndex: 0, blank: false }, [])).toBe(
    false,
  );
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audience-1");
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => {
    throw new Error("No object URLs");
  });
  expect(openAudienceScreen(popup, { slideIndex: 0, blank: false }, [])).toBe(
    false,
  );
});

it("leaves an unrevealed click animation off the audience screen", () => {
  const elements = [
    { id: "title", type: "text", content: "Welcome" },
    {
      id: "later",
      type: "text",
      content: "secret-value",
      animation: "fade-on-click",
    },
  ];
  const waiting = audienceLines(elements, 0);
  expect(waiting).toEqual(["Welcome"]);
  expect(waiting.join(" ")).not.toContain("secret-value");
  const shown = audienceScreenDocument(
    { slideIndex: 0, blank: false },
    waiting,
  );
  expect(shown).not.toContain("secret-value");
  expect(audienceLines(elements, 1)).toEqual(["Welcome", "secret-value"]);
});

it("uses master title text on a blank audience title and keeps typed words", () => {
  const master = [
    { id: "master-title", placeholder: "title", content: "Garden club" },
  ];
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
  const decorative = {
    id: "mark",
    type: "text" as const,
    content: "secret-value",
    decorative: true,
  };
  const lines = audienceLines([
    decorative,
    { id: "title", type: "text", content: "North" },
    { id: "photo", type: "image", alt: "secret-value", decorative: true },
  ]);
  expect(lines).toEqual(["North"]);
  expect(lines.join(" ")).not.toContain("secret-value");
  expect(decorative.content).toBe("secret-value");
});

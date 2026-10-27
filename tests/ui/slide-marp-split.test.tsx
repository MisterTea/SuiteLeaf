// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorActions } from "../../apps/web/src/ui";
import type { SlideFile } from "../../packages/core/src";
import Slides from "../../apps/web/src/editors/Slides";
import { CommandPalette } from "../../apps/web/src/command-palette";
import { buildMarpFile } from "../../apps/web/src/editors/slide-marp-import";
import { MARP_UNSUPPORTED } from "../../apps/web/src/editors/slide-marp-sync";
import { clampMarpSplit } from "../../apps/web/src/editors/slide-marp-split";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */",
}));
vi.mock("../../apps/web/src/editors/slide-marp-fit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/web/src/editors/slide-marp-fit")>();
  return {
    ...actual,
    fitMarpDeck: vi.fn(async (deck) => (await import("../marp-fixtures")).fakeFit(deck)),
  };
});

const SOURCE = `---
marp: true
---

# Launch plan

Ship the **beta** in May.

---

# Risks

- Hiring
- Budget
`;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(markdown = SOURCE, readOnly = false) {
  const file = buildMarpFile("Plan", markdown);
  const onChange = vi.fn<(content: SlideFile["content"]) => void>();
  const onError = vi.fn<(message: string) => void>();
  let actions: EditorActions | null = null;
  render(
    <CommandPalette kind="slide">
      <Slides
        file={file}
        onChange={onChange}
        onError={onError}
        onActions={(next) => {
          actions = next;
        }}
        readOnly={readOnly}
      />
    </CommandPalette>,
  );
  return { file, onChange, onError, actions: () => actions! };
}

const markdown = () => screen.getByLabelText<HTMLTextAreaElement>("Presentation markdown");
const canvas = () => document.querySelector<HTMLElement>(".slide-canvas");
const laidOut = () =>
  waitFor(() => {
    expect(canvas()).not.toBeNull();
    expect(canvas()!.getAttribute("aria-busy")).toBeNull();
  });
const box = (text: string) =>
  [...document.querySelectorAll<HTMLElement>(".slide-canvas [data-element-id]")].find((el) =>
    (el.querySelector("textarea")?.value ?? el.textContent ?? "").includes(text),
  );

describe("MARP side-by-side editing", () => {
  it("opens the slide on the left and its markdown on the right", async () => {
    open();
    await laidOut();
    const row = document.querySelector(".slide-stage-row")!;
    const viewport = row.querySelector(".slide-stage-viewport")!;
    const pane = screen.getByRole("complementary", { name: "Markdown" });
    expect(viewport.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(markdown().value).toBe(SOURCE);
    expect(screen.getByRole("button", { name: "Markdown" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(screen.queryByLabelText("Presentation markdown")).toBeNull();
    expect(canvas()).not.toBeNull();
  });

  it("shows markdown changes on the slide", async () => {
    const { onChange } = open();
    await laidOut();
    fireEvent.change(markdown(), { target: { value: SOURCE.replace("# Launch plan", "# Launch day") } });
    await waitFor(() => expect(box("Launch day")).toBeDefined());
    await laidOut();
    expect(onChange.mock.lastCall![0].marpSource).toContain("# Launch day");
  });

  it("draws the thumbnails and the slideshow the way MARP draws the slides", async () => {
    open();
    await laidOut();
    const drawn = (scope: ParentNode) =>
      [...scope.querySelectorAll<HTMLIFrameElement>("iframe.marp-frame")].map((frame) => frame.srcdoc);
    await waitFor(() => {
      const thumbnails = [...document.querySelectorAll(".thumbnail-preview")].map(drawn);
      expect(thumbnails).toHaveLength(2);
      expect(thumbnails[0].join()).toContain("Launch plan");
      expect(thumbnails[1].join()).toContain("Risks");
    });

    fireEvent.click(screen.getByRole("button", { name: "Slideshow" }));
    const show = screen.getByRole("dialog", { name: "Slideshow" });
    await waitFor(() => {
      const current = show.querySelector(".presenter-slide-box > .slide-still:not(.slide-still-waiting)")!;
      expect(current.querySelector(".slide-surface")!.className).toContain("marp-painted");
      expect(current.querySelector<HTMLIFrameElement>("iframe[data-state=shown]")?.srcdoc).toContain(
        "Launch plan",
      );
      const waiting = show.querySelector(".presenter-slide-box > .slide-still-waiting")!;
      expect(drawn(waiting).join()).toContain("Risks");
    });
    expect(show.textContent).toContain("Launch plan");
  });

  it("draws thumbnails and the slideshow with the editor's own boxes", async () => {
    open();
    await laidOut();
    const editorBox = box("Ship the")!;
    const thumbnail = document.querySelectorAll(".thumbnail-preview")[0];
    const drawnBox = [...thumbnail.querySelectorAll<HTMLElement>(".slide-surface > .slide-text")].find((el) =>
      el.textContent?.includes("Ship the"),
    )!;
    expect(drawnBox.className.split(" ")).toEqual(
      expect.arrayContaining(["slide-element", "slide-text"]),
    );
    for (const property of ["left", "top", "width", "height", "fontSize", "lineHeight", "fontFamily"] as const)
      expect(drawnBox.style[property]).toBe(editorBox.style[property]);
    expect(thumbnail.querySelector("[data-element-id], textarea")).toBeNull();
  });

  it("keeps both panes at least 280 pixels wide when the row has room", () => {
    expect(clampMarpSplit(0.05, 1400)).toBe(0.2);
    expect(clampMarpSplit(0.99, 1400)).toBe(0.8);
    expect(clampMarpSplit(0.63, 1400)).toBe(0.63);
    expect(clampMarpSplit(0.1, 400)).toBe(0.5);
  });

  it("resizes the slide and markdown panes from the keyboard and remembers the split", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    open();
    await laidOut();
    const handle = screen.getByRole("separator", { name: "Resize the slide and markdown panes" });
    const row = () => document.querySelector<HTMLElement>(".slide-stage-row")!;
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    expect(row().style.getPropertyValue("--marp-split")).toBe("0.5");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe("48");
    expect(handle.getAttribute("aria-valuetext")).toBe("Slide 48%, markdown 52%");
    expect(row().style.getPropertyValue("--marp-split")).toBe("0.48");
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(handle.getAttribute("aria-valuenow")).toBe("58");
    expect(localStorage.getItem("suiteleaf.marpSplit")).toBe("0.58");

    cleanup();
    open();
    await laidOut();
    const again = screen.getByRole("separator", { name: "Resize the slide and markdown panes" });
    expect(again.getAttribute("aria-valuenow")).toBe("58");
    fireEvent.doubleClick(again);
    expect(again.getAttribute("aria-valuenow")).toBe("50");
    expect(localStorage.getItem("suiteleaf.marpSplit")).toBe("0.5");

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(screen.queryByRole("separator", { name: "Resize the slide and markdown panes" })).toBeNull();
    expect(row().style.getPropertyValue("--marp-split")).toBe("");
  });

  it("puts the markdown caret on the first character of the box chosen on the slide", async () => {
    open();
    await laidOut();
    fireEvent.mouseDown(box("Ship the")!);
    fireEvent.mouseUp(window);
    await waitFor(() => expect(markdown().selectionStart).toBe(SOURCE.indexOf("Ship the")));
    expect(document.activeElement).not.toBe(markdown());

    fireEvent.click(screen.getByRole("option", { name: /^Slide 2:/ }));
    await waitFor(() => expect(box("Hiring")).toBeDefined());
    fireEvent.mouseDown(box("Hiring")!);
    fireEvent.mouseUp(window);
    await waitFor(() => expect(markdown().selectionStart).toBe(SOURCE.indexOf("- Hiring")));
  });

  it("shows the slide the markdown caret moves onto", async () => {
    open();
    await laidOut();
    const active = () => document.querySelector(".thumbnail-row.active")?.getAttribute("aria-label");
    const caretTo = (text: string, how: "click" | "key" = "key") => {
      const area = markdown();
      if (how === "click") fireEvent.mouseDown(area);
      act(() => area.focus());
      area.setSelectionRange(SOURCE.indexOf(text), SOURCE.indexOf(text));
      if (how === "click") fireEvent.mouseUp(area);
      else fireEvent.keyUp(area, { key: "ArrowDown" });
    };
    expect(active()).toMatch(/^Slide 1:/);
    caretTo("- Budget", "click");
    expect(active()).toMatch(/^Slide 2:/);
    caretTo("---\n\n# Risks");
    expect(active()).toMatch(/^Slide 2:/);
    caretTo("Ship the");
    expect(active()).toMatch(/^Slide 1:/);
    caretTo("marp: true");
    expect(active()).toMatch(/^Slide 1:/);
  });

  it("lets the slides follow the markdown once typing pauses, or at once when it loses focus", async () => {
    const { onChange } = open();
    await laidOut();
    const saved = () => onChange.mock.lastCall?.[0].marpSource;
    fireEvent.change(markdown(), { target: { value: SOURCE.replace("# Launch plan", "# Launch day") } });
    expect(markdown().value).toContain("# Launch day");
    expect(box("Launch plan")).toBeDefined();
    expect(saved() ?? SOURCE).not.toContain("# Launch day");
    await waitFor(() => expect(box("Launch day")).toBeDefined());
    expect(saved()).toContain("# Launch day");

    fireEvent.change(markdown(), { target: { value: SOURCE.replace("# Launch plan", "# Launch week") } });
    expect(saved()).not.toContain("# Launch week");
    fireEvent.blur(markdown());
    expect(saved()).toContain("# Launch week");
    await waitFor(() => expect(box("Launch week")).toBeDefined());
    await laidOut();
  });

  it("undo right after typing markdown takes back the typing", async () => {
    const { actions } = open();
    await laidOut();
    fireEvent.change(markdown(), { target: { value: SOURCE.replace("# Launch plan", "# Launch day") } });
    act(() => actions().slideActions!.undo());
    await waitFor(() => expect(markdown().value).toBe(SOURCE));
    expect(box("Launch plan")).toBeDefined();
  });

  it("says the markdown is invalid on the slide pane until it is fixed", async () => {
    const { onChange } = open();
    await laidOut();
    const broken = `${SOURCE}\n\`\`\`js\nconst open = true;\n`;
    fireEvent.change(markdown(), { target: { value: broken } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The markdown is invalid.");
    expect(alert.textContent).toContain("The code block that starts on line");
    expect(canvas()).toBeNull();
    expect(markdown().value).toBe(broken);
    expect(markdown().getAttribute("aria-invalid")).toBe("true");
    expect(onChange.mock.lastCall![0].marpSource).toBe(broken);
    fireEvent.change(markdown(), { target: { value: `${broken}\`\`\`\n` } });
    await laidOut();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(markdown().getAttribute("aria-invalid")).toBeNull();
  });

  it("writes text typed on the slide into the markdown", async () => {
    open();
    await laidOut();
    const title = box("Launch plan")!.querySelector("textarea")!;
    act(() => title.focus());
    fireEvent.change(title, { target: { value: "Launch plan v2" } });
    expect(markdown().value).toBe(SOURCE.replace("# Launch plan", "# Launch plan v2"));
    act(() => title.blur());
    await laidOut();
    expect(box("Launch plan v2")).toBeDefined();
  });

  it("undoes a slide edit back to the markdown it came from", async () => {
    const { actions } = open();
    await laidOut();
    const title = box("Launch plan")!.querySelector("textarea")!;
    act(() => title.focus());
    fireEvent.change(title, { target: { value: "Launch later" } });
    act(() => title.blur());
    await laidOut();
    expect(markdown().value).toContain("# Launch later");
    act(() => actions().slideActions!.undo());
    expect(markdown().value).toBe(SOURCE);
    await laidOut();
    expect(box("Launch plan")).toBeDefined();
    act(() => actions().slideActions!.redo());
    expect(markdown().value).toContain("# Launch later");
  });

  it("opens a deck saved with invalid markdown on the invalid notice", async () => {
    open(`${SOURCE}\n<!-- never closed\n`);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The comment that starts on line 16 is never closed with -->.");
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>("Click to add speaker notes").readOnly).toBe(true);
  });

  it("writes speaker notes into the markdown", async () => {
    open();
    await laidOut();
    fireEvent.change(screen.getByPlaceholderText("Click to add speaker notes"), {
      target: { value: "Thank the team." },
    });
    expect(markdown().value).toContain("Ship the **beta** in May.\n\n<!--\nThank the team.\n-->\n\n---");
  });

  it("adds a slide as markdown and lays it out", async () => {
    const { actions } = open();
    await laidOut();
    act(() => actions().slideActions!.newSlide());
    expect(markdown().value).toContain("Ship the **beta** in May.\n\n---\n\n# New slide\n\n---\n\n# Risks");
    await laidOut();
    expect(box("New slide")).toBeDefined();
  });

  it("refuses a change markdown cannot describe and says why", async () => {
    const { actions, onError } = open();
    await laidOut();
    act(() => actions().slideActions!.insertShape("rect"));
    expect(onError).toHaveBeenCalledWith(MARP_UNSUPPORTED);
    expect(markdown().value).toBe(SOURCE);
    expect(document.querySelectorAll(".slide-canvas .slide-shape")).toHaveLength(0);
  });

  it("offers only the formatting markdown can write", async () => {
    open();
    await laidOut();
    fireEvent.mouseDown(box("Ship the")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).toBeDefined());
    expect(screen.getByRole("button", { name: "Underline" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Accent colour for the selection" })).toBeDefined();
    for (const name of ["Align left", "Bullet list", "Font size"])
      expect(screen.queryByRole("button", { name }) ?? screen.queryByLabelText(name)).toBeNull();
    expect(screen.queryByRole("button", { name: "Fill" })).toBeNull();
    fireEvent.mouseUp(window);
  });

  it("colors and underlines a whole box from the toolbar as inline HTML", async () => {
    open();
    await laidOut();
    fireEvent.mouseDown(box("Launch plan")!);
    fireEvent.mouseUp(window);
    fireEvent.click(await screen.findByRole("button", { name: "Underline" }));
    expect(markdown().value).toContain("\n# <u>Launch plan</u>\n");
    await laidOut();
    fireEvent.mouseDown(box("Launch plan")!);
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole("button", { name: "Accent colour for the selection" }));
    expect(markdown().value).toMatch(/\n# <span style="color: #[0-9a-f]{6}"><u>Launch plan<\/u><\/span>\n/);
  });

  it("shows HTML as a locked block that opens its lines in the markdown", async () => {
    const source = `${SOURCE}\n<div class="note">Note</div>\n`;
    open(source);
    await laidOut();
    fireEvent.click(screen.getByRole("option", { name: /^Slide 2:/ }));
    const block = await screen.findByLabelText("HTML block. Double-click to edit it in the markdown.");
    expect(block.textContent).toBe("HTML");
    fireEvent.doubleClick(block);
    await waitFor(() => expect(document.activeElement).toBe(markdown()));
    const area = markdown();
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('<div class="note">Note</div>');
    fireEvent.mouseDown(block);
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole("button", { name: "Delete element" }));
    expect(markdown().value).toBe(SOURCE);
  });

  it("says a container tag is never closed on the slide pane", async () => {
    open();
    await laidOut();
    fireEvent.change(markdown(), { target: { value: `${SOURCE}\n<div class="note">\n\nNote\n` } });
    expect((await screen.findByRole("alert")).textContent).toContain("The <div> on line 16 is never closed.");
  });

  it("lets a viewer read the markdown but not change it", async () => {
    open(SOURCE, true);
    await laidOut();
    expect(markdown().readOnly).toBe(true);
    expect(markdown().value).toBe(SOURCE);
  });
});

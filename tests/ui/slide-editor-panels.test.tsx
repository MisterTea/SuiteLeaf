// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DECK_THEMES } from "../../apps/web/src/editors/slide-theme";
import { openSlides, pick, press, setupSlidesDom, words } from "./slide-editor-harness";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));

setupSlidesDom();

const panel = (name: string) => screen.getByRole("complementary", { name });
const button = (name: string, root: HTMLElement = document.body) => within(root).getByRole("button", { name });

describe("the theme panel", () => {
  it("previews on hover, applies a theme, customizes it, and saves it to the library", () => {
    const editor = openSlides({ slides: { a: [words("t", "Hello", { placeholder: "Click to add title" })], b: [] } });
    act(() => editor.slide().openTheme());
    const themes = panel("Theme");
    expect(within(themes).getByText("Pick a theme, then adjust it here.")).toBeTruthy();
    expect(button("Save to library", themes)).toHaveProperty("disabled", true);
    const [first, second] = DECK_THEMES;
    fireEvent.mouseEnter(button(first.name, themes));
    expect(document.querySelector<HTMLElement>(".slide-canvas")!.style.backgroundColor).not.toBe("");
    fireEvent.mouseLeave(themes.querySelector(".theme-grid")!);
    fireEvent.click(button(second.name, themes));
    expect(editor.deck().theme?.id).toBe(second.id);
    expect(within(themes).getByText(new RegExp(`${second.name} is on every slide`))).toBeTruthy();

    fireEvent.change(within(themes).getByLabelText("Accent hex"), { target: { value: "#12ab34" } });
    expect(editor.deck().theme?.accent).toBe("#12ab34");
    fireEvent.change(within(themes).getByLabelText("Accent hex"), { target: { value: "nope" } });
    expect(editor.deck().theme?.accent).toBe("#12ab34");
    const heading = within(themes).getByLabelText("Heading font") as HTMLSelectElement;
    const font = [...heading.options].map((option) => option.value).find((value) => value !== heading.value)!;
    fireEvent.change(heading, { target: { value: font } });
    fireEvent.change(within(themes).getByLabelText("Body font"), { target: { value: font } });
    expect(editor.deck().theme).toMatchObject({ headingFont: font, bodyFont: font });
    expect(button(second.name, themes).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button("Save to library", themes));
    const name = within(themes).getByLabelText("Theme name");
    fireEvent.keyDown(name, { key: "Escape" });
    expect(within(themes).queryByLabelText("Theme name")).toBeNull();
    fireEvent.click(button("Save to library", themes));
    fireEvent.change(within(themes).getByLabelText("Theme name"), { target: { value: "Club look" } });
    fireEvent.submit(within(themes).getByLabelText("Theme name").closest("form")!);
    expect(within(themes).getByText("Club look is in the library.")).toBeTruthy();
    const saved = within(themes.querySelector<HTMLElement>(".theme-library")!).getByRole("button", { name: "Club look" });
    fireEvent.mouseEnter(saved);
    fireEvent.focus(saved);
    fireEvent.click(saved);
    expect(editor.deck().theme?.name).toBe("Club look");

    fireEvent.change(within(themes).getByLabelText("Accent hex"), { target: { value: "#000000" } });
    expect(within(themes).getByText(/This deck has its own copy/)).toBeTruthy();

    fireEvent.click(button("Save to library", themes));
    fireEvent.change(within(themes).getByLabelText("Theme name"), { target: { value: "x".repeat(3) } });
    fireEvent.click(button("Cancel", themes));
    fireEvent.click(button("Close panel", themes));
    expect(screen.queryByRole("complementary", { name: "Theme" })).toBeNull();
  });

  it("ignores hovering a card while the accent field is being typed in", () => {
    const editor = openSlides({ edit: (deck) => (deck.theme = DECK_THEMES[0]) });
    act(() => editor.slide().openTheme());
    const themes = panel("Theme");
    within(themes).getByLabelText("Accent hex").focus();
    const before = document.querySelector<HTMLElement>(".slide-canvas")!.style.backgroundColor;
    fireEvent.mouseEnter(button(DECK_THEMES[2].name, themes));
    fireEvent.focus(button(DECK_THEMES[2].name, themes));
    expect(document.querySelector<HTMLElement>(".slide-canvas")!.style.backgroundColor).toBe(before);
  });
});

describe("the transition panel", () => {
  it("sets the transition, its length, and automatic advance for all or the chosen slides", () => {
    const editor = openSlides();
    act(() => editor.slide().openTransition());
    const transitions = panel("Transition");
    fireEvent.click(button("Play", transitions));
    fireEvent.click(button("Fade", transitions));
    expect(Object.values(editor.deck().slides).every((slide) => slide.transition?.type === "fade")).toBe(true);
    expect(within(transitions).getByText(/Fade · 0.4 s · all slides/)).toBeTruthy();
    expect(document.querySelector('.thumbnail-row[data-slide-id="b"]')!.getAttribute("aria-label")).toContain("fade transition");

    fireEvent.change(within(transitions).getByLabelText("Duration"), { target: { value: "1.2" } });
    expect(editor.deck().slides.c.transition?.duration).toBe(1.2);
    fireEvent.click(button("Play", transitions));

    fireEvent.change(within(transitions).getByLabelText("Advance after seconds"), { target: { value: "5" } });
    expect(editor.deck().slides.b.advanceSeconds).toBe(5);
    fireEvent.change(within(transitions).getByLabelText("Advance after seconds"), { target: { value: "0.5" } });
    expect(editor.deck().slides.b.advanceSeconds).toBe(5);
    fireEvent.change(within(transitions).getByLabelText("Advance after seconds"), { target: { value: " " } });
    expect(editor.deck().slides.b.advanceSeconds).toBeUndefined();

    fireEvent.click(document.querySelector('.thumbnail-row[data-slide-id="c"]')!, { shiftKey: true });
    expect(button("Selected (3)", transitions).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(document.querySelector('.thumbnail-row[data-slide-id="b"]')!);
    fireEvent.click(button("Selected (1)", transitions));
    fireEvent.click(button("None", transitions));
    expect(editor.deck().slides.b.transition?.type).toBe("none");
    expect(editor.deck().slides.a.transition?.type).toBe("fade");
    expect(within(transitions).getByText("Cut on 1 slides")).toBeTruthy();
    fireEvent.click(button("Apply to all slides", transitions));
    expect(editor.deck().slides.a.transition?.type).toBe("none");
    expect(within(transitions).getByText("Cut on every slide")).toBeTruthy();
    fireEvent.click(button("All slides", transitions));
    act(() => editor.slide().openTransition());
  });
});

describe("other panels", () => {
  it("opens and closes the animation pane and the slide master from the menus", async () => {
    const editor = openSlides({ slides: { a: [words("one", "One"), words("two", "Two", { y: 200 })], b: [] } });
    for (const id of ["one", "two"]) {
      pick(id);
      act(() => editor.slide().fadeOnClick());
    }
    act(() => editor.slide().openAnimationPane());
    const pane = screen.getByRole("complementary", { name: /Animation/ });
    const order = () => [...pane.querySelectorAll("li > button:first-child")].map((row) => row.textContent);
    fireEvent.click(within(pane).getByRole("button", { name: /^1\./ }));
    expect(document.querySelector('.slide-canvas [data-element-id="one"]')!.className).toContain("selected");
    const before = order();
    expect(before).toHaveLength(2);
    fireEvent.click(within(pane).getAllByRole("button", { name: /later$/ })[0]);
    expect(order()).toEqual([...before].reverse().map((row, index) => row!.replace(/^\d+/, String(index + 1))));
    fireEvent.click(within(pane).getAllByRole("button", { name: /earlier$/ })[1]);
    expect(order()).toEqual(before);
    fireEvent.click(button("Close panel", pane));
    expect(screen.queryByRole("complementary", { name: /Animation/ })).toBeNull();
    act(() => editor.slide().openAnimationPane());
    act(() => editor.slide().openAnimationPane());
    expect(screen.queryByRole("complementary", { name: /Animation/ })).toBeNull();

    act(() => editor.slide().openMaster());
    const master = panel("Slide master");
    fireEvent.change(within(master).getByLabelText("Master background"), { target: { value: "#ffeecc" } });
    expect(editor.deck().master?.background?.color).toBe("#ffeecc");
    fireEvent.change(within(master).getByLabelText("Master footer text"), { target: { value: "  " } });
    expect(button("Add footer to master", master)).toHaveProperty("disabled", true);
    fireEvent.change(within(master).getByLabelText("Master footer text"), { target: { value: "Club" } });
    fireEvent.click(button("Add footer to master", master));
    expect(editor.deck().master?.elements?.[0]).toMatchObject({ type: "text", content: "Club" });
    fireEvent.change(within(master).getByLabelText("Master text"), { target: { value: "Garden" } });
    expect(editor.deck().master?.elements?.[0].content).toBe("Garden");

    const logo = within(master).getByLabelText("Master logo");
    fireEvent.change(logo, { target: { files: [new File(["x"], "big.png", { type: "image/png" })].map((file) => Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 })) } });
    fireEvent.change(logo, { target: { files: [new File(["png"], "logo.png", { type: "image/png" })] } });
    await waitFor(() => expect(editor.deck().master?.elements).toHaveLength(2));
    expect(within(master).getByText(/Image|logo/)).toBeTruthy();
    fireEvent.click(within(master).getAllByRole("button", { name: "Remove" })[0]);
    expect(editor.deck().master?.elements).toHaveLength(1);
    act(() => editor.slide().openMaster());
    expect(screen.queryByRole("complementary", { name: "Slide master" })).toBeNull();
  });

  it("sets the proofing language and opens the size and position panel", () => {
    const editor = openSlides();
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    const language = screen.getByRole("combobox", { name: /language/i }) as HTMLSelectElement;
    const other = [...language.options].map((option) => option.value).find((value) => value && value !== language.value)!;
    fireEvent.change(language, { target: { value: other } });
    expect(editor.deck().proofingLanguage).toBe(other);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    expect(screen.queryByRole("combobox", { name: /language/i })).toBeNull();
  });

  it("shows handouts with a choice of slides per page and closes on Escape", () => {
    const editor = openSlides({ slides: { a: [], b: [], c: [], d: [], e: [] } });
    act(() => editor.slide().handouts());
    const dialog = screen.getByRole("dialog", { name: "Handouts" });
    expect(within(dialog).getAllByRole("region").map((page) => page.getAttribute("aria-label"))).toEqual(["Page 1", "Page 2"]);
    fireEvent.change(within(dialog).getByLabelText("Slides per page"), { target: { value: "2" } });
    expect(within(dialog).getAllByRole("region")).toHaveLength(3);
    fireEvent.change(within(dialog).getByLabelText("Slides per page"), { target: { value: "6" } });
    expect(within(dialog).getAllByRole("region")).toHaveLength(1);
    press("Delete");
    expect(editor.order()).toHaveLength(5);
    press("Escape");
    expect(screen.queryByRole("dialog", { name: "Handouts" })).toBeNull();
    act(() => editor.slide().handouts());
    fireEvent.click(button("Close", screen.getByRole("dialog", { name: "Handouts" })));
    expect(screen.queryByRole("dialog", { name: "Handouts" })).toBeNull();
  });

  it("opens the accessibility checker and writes alt text back to the picture", () => {
    const editor = openSlides({
      slides: { a: [words("t", "Title"), { id: "pic", type: "image", x: 0, y: 0, width: 50, height: 50, src: "data:image/png;base64,AA==" }] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accessibility" }));
    fireEvent.change(screen.getByRole("textbox", { name: "image pic" }), { target: { value: "A logo" } });
    expect(editor.elements("a").find((el) => el.id === "pic")?.alt).toBe("A logo");
    fireEvent.click(screen.getByRole("button", { name: "Accessibility" }));
  });

  it("opens the spelling check", () => {
    const editor = openSlides();
    act(() => editor.slide().openSpelling());
    expect(screen.getByRole("dialog", { name: /Spelling/ })).toBeTruthy();
  });
});

describe("slide comments", () => {
  it("asks for an object first, then posts, replies, resolves, and reopens a comment", () => {
    const editor = openSlides();
    act(() => editor.slide().insertComment());
    const dock = () => screen.getByRole("complementary", { name: "Slide comments" });
    expect(within(dock()).getByText(/Select an object on the slide/)).toBeTruthy();
    fireEvent.click(button("Close comments", dock()));

    pick("a-words");
    act(() => editor.slide().insertComment());
    const comment = within(dock()).getByLabelText("Comment");
    expect(document.activeElement).toBe(comment);
    fireEvent.change(comment, { target: { value: "Shorter, please" } });
    fireEvent.submit(comment.closest("form")!);
    expect(within(dock()).getByText(/Add your name/)).toBeTruthy();
    const name = within(dock()).getByLabelText("Your name");
    fireEvent.change(name, { target: { value: "Ada" } });
    fireEvent.keyDown(name, { key: "Enter", metaKey: true });
    expect(document.activeElement).toBe(comment);
    fireEvent.keyDown(comment, { key: "Enter", ctrlKey: true });
    const thread = editor.deck().slides.a.comments?.[0];
    expect(thread?.messages[0]).toMatchObject({ text: "Shorter, please", authorName: "Ada" });

    const reply = within(dock()).getByLabelText("Reply");
    fireEvent.change(reply, { target: { value: "Done" } });
    fireEvent.keyDown(reply, { key: "Enter", metaKey: true });
    expect(editor.deck().slides.a.comments?.[0].messages).toHaveLength(2);
    fireEvent.change(within(dock()).getByLabelText("Reply"), { target: { value: "Again" } });
    fireEvent.click(button("Reply", dock()));
    expect(editor.deck().slides.a.comments?.[0].messages).toHaveLength(3);

    fireEvent.click(button("Resolve", dock()));
    expect(editor.deck().slides.a.comments?.[0]).toMatchObject({ resolved: true, resolvedBy: "Ada" });
    expect(screen.getByText(/Resolved by Ada/)).toBeTruthy();

    fireEvent.click(document.querySelector('.thumbnail-row[data-slide-id="b"]')!);
    act(() => editor.slide().openResolved());
    const resolved = within(dock()).getByRole("region", { name: "Resolved comments" });
    expect(within(resolved).getByText("Resolved by Ada")).toBeTruthy();
    fireEvent.click(button("Reopen", resolved));
    expect(editor.active()).toBe("a");
    expect(editor.deck().slides.a.comments?.[0].resolved).toBeFalsy();
    expect(within(dock()).getByLabelText("Reply")).toBeTruthy();

    act(() => editor.slide().toggleComments());
    const open = within(dock()).getByRole("region", { name: "Open comments" });
    fireEvent.click(within(dock()).getByRole("tab", { name: "Resolved" }));
    expect(within(dock()).getByText("No resolved comments.")).toBeTruthy();
    fireEvent.click(within(dock()).getByRole("tab", { name: "Open" }));
    expect(open).toBeTruthy();
    fireEvent.click(document.querySelector('.thumbnail-row[data-slide-id="c"]')!);
    fireEvent.click(button("Open", within(dock()).getByRole("region", { name: "Open comments" })));
    expect(editor.active()).toBe("a");
    act(() => editor.slide().toggleComments());
    act(() => editor.slide().toggleComments());
    expect(screen.queryByRole("complementary", { name: "Slide comments" })).toBeNull();

    const mark = screen.getByRole("button", { name: /^Comment on/ });
    fireEvent.mouseDown(mark);
    fireEvent.click(mark);
    expect(mark.getAttribute("aria-expanded")).toBe("true");
    pick("a-words");
    act(() => editor.slide().insertComment());
    expect(within(dock()).getByLabelText("Reply")).toBeTruthy();
    fireEvent.keyDown(within(dock()).getByLabelText("Reply"), { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Slide comments" })).toBeNull();
  });

  it("opens the composer with the keyboard shortcut and cancels it", () => {
    const editor = openSlides({ slides: { a: [words("one", "One"), words("two", "Two", { y: 200 })] } });
    localStorage.setItem("suiteleaf:display-name", "Grace");
    pick("two");
    const shortcut = { code: "KeyM", key: "µ", altKey: true, metaKey: true, ctrlKey: true };
    fireEvent.keyDown(window, { ...shortcut, metaKey: !navigator.platform.includes("Mac") ? false : true, ctrlKey: !navigator.platform.includes("Mac") });
    const dock = screen.getByRole("complementary", { name: "Slide comments" });
    fireEvent.click(button("Cancel", dock));
    expect(screen.queryByRole("complementary", { name: "Slide comments" })).toBeNull();
    fireEvent.keyDown(window, { ...shortcut, shiftKey: true });
    expect(screen.queryByRole("complementary", { name: "Slide comments" })).toBeNull();
    expect(editor.deck().slides.a.comments).toBeUndefined();
  });
});

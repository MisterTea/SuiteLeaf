// @vitest-environment jsdom
import {
  slideTextEditor,
  restoreTiptapSelection,
} from "../../apps/web/src/editors/slide-tiptap-selection";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  openSlides,
  pick,
  setupSlidesDom,
  words,
} from "./slide-editor-harness";
vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */",
}));
setupSlidesDom();
const click = (name: string, root: HTMLElement = document.body) =>
  fireEvent.click(within(root).getByRole("button", { name, exact: true }));
const ribbon = () => screen.getByRole("region", { name: "Animations ribbon" });
const pane = () =>
  screen.getByRole("complementary", { name: "Animation pane" });

function open() {
  return openSlides({
    slides: { a: [words("one", "One"), words("two", "Two", { y: 200 })] },
  });
}

describe("Animations mode", () => {
  it("adds effects, edits timing, reorders, removes and undoes saved animations", () => {
    const editor = open();
    click("Animations");
    expect(
      within(ribbon()).getByRole("button", { name: "Fade" }),
    ).toBeDisabled();
    expect(within(pane()).getByText(/No animations yet/)).toBeTruthy();
    pick("one");
    click("Fade", ribbon());
    expect(editor.deck().slides.a.elements[0].animation).toBe("fade-on-click");
    fireEvent.change(screen.getByLabelText("Animation start"), {
      target: { value: "with" },
    });
    fireEvent.change(screen.getByLabelText("Animation duration"), {
      target: { value: "1.4" },
    });
    expect(editor.deck().slides.a.elements[0]).toMatchObject({
      animationTrigger: "with",
      animationDuration: 1400,
    });
    fireEvent.change(screen.getByLabelText("Animation duration"), {
      target: { value: "" },
    });
    expect(editor.deck().slides.a.elements[0].animationDuration).toBe(1400);
    pick("two");
    click("Fly in", ribbon());
    click("Move earlier", ribbon());
    expect(editor.deck().slides.a.elements[1].animationOrder).toBe(1);
    click("Move later", ribbon());
    click("Remove Two animation", pane());
    expect(editor.deck().slides.a.elements[1].animation).toBeUndefined();
    act(() => editor.slide().undo());
    expect(editor.deck().slides.a.elements[1].animation).toBe("fly-on-click");
    click("None", ribbon());
    expect(editor.deck().slides.a.elements[1].animation).toBeUndefined();
    click("Close animations", ribbon());
    expect(
      screen.queryByRole("region", { name: "Animations ribbon" }),
    ).toBeNull();
  });

  it("selects individual imported builds and keeps their timing separate", () => {
    const editor = openSlides({
      slides: {
        a: [
          words("one", "One\nTwo", {
            paragraphBuilds: [
              { start: 0, end: 0, order: 1 },
              { start: 1, end: 1, order: 2 },
            ],
            animationExit: { order: 3 },
          }),
        ],
      },
    });
    click("Animations");
    click("2. Two (paragraph 2)", pane());
    fireEvent.change(screen.getByLabelText("Animation start"), {
      target: { value: "after" },
    });
    expect(
      editor.deck().slides.a.elements[0].paragraphBuilds?.map((b) => b.trigger),
    ).toEqual([undefined, "after"]);
    click("None", ribbon());
    expect(editor.deck().slides.a.elements[0].paragraphBuilds).toEqual([]);
    expect(editor.deck().slides.a.elements[0].animationExit).toBeUndefined();
  });

  it("previews the canvas, supports replay and stop, and cleans up on unmount", () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    const editor = open();
    click("Animations");
    pick("one");
    click("Zoom", ribbon());
    click("Preview", ribbon());
    expect(animate).toHaveBeenCalledWith(
      [
        { opacity: 0, scale: 0.82 },
        { opacity: 1, scale: 1 },
      ],
      expect.objectContaining({ duration: 600, fill: "both" }),
    );
    click("Stop preview", ribbon());
    expect(cancel).toHaveBeenCalled();
    click("Preview One", pane());
    click("Play All", pane());
    editor.unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
  });

  it("allows viewers to inspect and preview while disabling changes", () => {
    openSlides({
      readOnly: true,
      slides: { a: [words("one", "One", { animation: "fade-on-click" })] },
    });
    click("Animations");
    click("1. One", pane());
    expect(
      within(ribbon()).getByRole("button", { name: "Fade" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Animation start")).toBeDisabled();
    expect(
      within(pane()).getByRole("button", { name: "Remove One animation" }),
    ).toHaveProperty("disabled", true);
    expect(
      within(pane()).getByRole("button", { name: "Play All" }),
    ).toHaveProperty("disabled", false);
  });
});

it("offers one animation row and one set of controls for an imported picture and its border", () => {
  const base = words("picture", "", {
    type: "image",
    src: "data:image/png;base64,iVBORw0KGgo=",
    alt: "Slide image",
    sourceShapeId: "5",
    animation: "appear-on-click",
    animationOrder: 1,
  });
  const editor = openSlides({
    slides: {
      a: [
        { ...base, id: "fill", type: "shape" },
        base,
        { ...base, id: "border", type: "shape" },
        words("caption", "Caption", {
          sourceShapeId: "6",
          animation: "appear-on-click",
          animationOrder: 1,
          animationTrigger: "with",
        }),
      ],
    },
  });
  click("Animations");
  expect(within(pane()).getAllByRole("listitem")).toHaveLength(2);
  expect(within(pane()).queryByText("shape")).toBeNull();
  // Selecting the outline still edits the picture's one logical animation.
  pick("border");
  fireEvent.change(screen.getByLabelText("Animation duration"), {
    target: { value: "1.4" },
  });
  expect(
    editor
      .deck()
      .slides.a.elements.slice(0, 3)
      .map((el) => el.animationDuration),
  ).toEqual([1400, 1400, 1400]);
  click("Fly in", ribbon());
  expect(
    editor
      .deck()
      .slides.a.elements.slice(0, 3)
      .every((el) => el.animation === "fly-on-click"),
  ).toBe(true);
  click("Move Picture 1 later", pane());
  expect(
    editor
      .deck()
      .slides.a.elements.slice(0, 3)
      .map((el) => el.animationOrder),
  ).toEqual([2, 2, 2]);
  click("Remove Picture 1 animation", pane());
  expect(within(pane()).getAllByRole("listitem")).toHaveLength(1);
  expect(
    editor
      .deck()
      .slides.a.elements.slice(0, 3)
      .every((el) => !el.animation),
  ).toBe(true);
  act(() => editor.slide().undo());
  expect(within(pane()).getAllByRole("listitem")).toHaveLength(2);
  click("None", ribbon());
  expect(
    editor
      .deck()
      .slides.a.elements.slice(0, 3)
      .every((el) => !el.animation),
  ).toBe(true);
});

it("applies the ribbon effect only to highlighted bullets, and uses the whole box when no text is selected", async () => {
  const text = "• First bullet\n• Second bullet\n• Third bullet";
  const editor = openSlides({ slides: { a: [words("bullets", text)] } });
  click("Animations");
  pick("bullets");
  fireEvent.doubleClick(
    document.querySelector('.slide-canvas [data-element-id="bullets"]')!,
  );
  await waitFor(() => expect(document.querySelector('.slide-canvas .ProseMirror')).toBeTruthy());
  const node = document.querySelector<HTMLElement>('.slide-canvas .ProseMirror')!;
  const live = slideTextEditor(node)!;
  // Include uncommitted typing when mapping the highlighted text to bullets.
  act(() => {
    restoreTiptapSelection(live, 2, 2);
    live.commands.insertContent("Extra context ".repeat(5));
  });
  const second = text.indexOf("Second") + "Extra context ".repeat(5).length;
  act(() => restoreTiptapSelection(live, second, second + 6));
  const effect = within(ribbon()).getByRole("button", {
    name: "Fly in",
    exact: true,
  });
  fireEvent.mouseDown(effect);
  fireEvent.click(effect);
  expect(editor.deck().slides.a.elements[0].animation).toBeUndefined();
  expect(editor.deck().slides.a.elements[0].paragraphBuilds).toEqual([
    { start: 1, end: 1, order: 1, kind: "fly-on-click" },
  ]);
  expect(
    within(pane()).getByRole("button", {
      name: "1. • Second bullet (paragraph 2)",
    }),
  ).toBeTruthy();
  act(() => restoreTiptapSelection(live, second, second));
  click("Zoom", ribbon());
  expect(editor.deck().slides.a.elements[0].animation).toBe("zoom-on-click");
  expect(editor.deck().slides.a.elements[0].paragraphBuilds).toBeUndefined();
});

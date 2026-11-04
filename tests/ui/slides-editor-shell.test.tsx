// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SlideElement } from "../../packages/core/src";
import { svgDataUri, svgFromDataUri } from "../../apps/web/src/editors/svg-data";
import { box, openSlides, pick, setupSlidesDom, words } from "./slide-editor-harness";

setupSlidesDom();

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="4"/></svg>';
const picture = (extra: Partial<SlideElement> = {}): SlideElement => ({
  id: "pic",
  type: "image",
  x: 10,
  y: 10,
  width: 200,
  height: 200,
  src: svgDataUri(SVG),
  ...extra,
});

describe("the slides editor around the canvas", () => {
  it("inserts word art in the chosen style, and cancels without a change", () => {
    const view = openSlides();
    act(() => view.slide().insertWordArt());
    let dialog = screen.getByRole("dialog", { name: "Word art" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Word art" })).toBeNull();
    act(() => view.slide().insertWordArt());
    dialog = screen.getByRole("dialog", { name: "Word art" });
    fireEvent.change(within(dialog).getByLabelText("Text"), { target: { value: "Harvest fair" } });
    fireEvent.submit(dialog);
    expect(screen.queryByRole("dialog", { name: "Word art" })).toBeNull();
    expect(view.elements().some((element) => element.content === "Harvest fair")).toBe(true);
  });

  it("opens handouts from the View menu action and closes them", () => {
    const view = openSlides();
    act(() => view.slide().handouts());
    const dialog = screen.getByRole("dialog", { name: /handout/i });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /handout/i })).toBeNull();
  });

  it("opens the hidden file pickers for pictures, audio, and video", () => {
    const view = openSlides();
    const clicked: string[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      clicked.push(this.accept);
    });
    act(() => {
      view.slide().insertImage();
      view.slide().insertAudio();
      view.slide().insertVideo();
    });
    expect(clicked).toHaveLength(3);
    expect(clicked[1]).toMatch(/audio|wav|mp3/i);
    expect(clicked[2]).toMatch(/video|mp4/i);
  });

  it("edits text, alt text, and reading order from the accessibility panel", () => {
    const view = openSlides({
      slides: { a: [words("title", "Intro"), words("body", "Plan", { y: 200 }), picture({ alt: "" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accessibility" }));
    const panel = screen.getByRole("region", { name: "Slide accessibility" });
    fireEvent.change(within(panel).getByLabelText("text title"), { target: { value: "Welcome" } });
    expect(view.elements().find((element) => element.id === "title")!.content).toBe("Welcome");
    fireEvent.click(within(panel).getByLabelText("Decorative image pic"));
    expect(view.elements().find((element) => element.id === "pic")!.decorative).toBe(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Move text 2 earlier" }));
    expect(view.deck().slides.a.readingOrder?.slice(0, 2)).toEqual(["body", "title"]);
  });

  it("names the slides other people are on", () => {
    openSlides({ props: { remoteSelections: [{ name: "Ada", slideId: "b" }, { name: "Bo", slideId: "a", elementId: "a-words" }] } });
    expect(document.querySelector(".slides-remote-selections")?.textContent).toBe(
      "Ada is on a slide, Bo is on a slide, object a-words",
    );
  });

  it("suggests double-clicking a word to format it", () => {
    openSlides();
    pick("a-words");
    expect(screen.getByText("Double-click a word to format just that word.")).toBeTruthy();
  });
});

describe("an SVG picture on a slide", () => {
  it("opens in Drawing and comes back changed", async () => {
    const view = openSlides({ slides: { a: [picture()] } });
    fireEvent.doubleClick(box("pic"));
    const source = await screen.findByLabelText("SVG source", {}, { timeout: 5000 });
    fireEvent.change(source, { target: { value: SVG.replace('width="4"', 'width="9"') } });
    fireEvent.blur(source);
    fireEvent.click(screen.getByRole("button", { name: /^Back to / }));
    await waitFor(() => expect(svgFromDataUri(view.elements()[0].src!)).toContain('width="9"'));
    expect(view.onError).not.toHaveBeenCalled();
  });

  it("leaves the picture as it was when nothing changed, or for a viewer", async () => {
    const view = openSlides({ slides: { a: [picture()] } });
    const before = view.elements()[0].src;
    fireEvent.doubleClick(box("pic"));
    fireEvent.click(await screen.findByRole("button", { name: /^Back to / }, { timeout: 5000 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Back to / })).toBeNull());
    expect(view.elements()[0].src).toBe(before);
  });

  it("says when a MARP deck's picture did not come in with the deck", () => {
    const view = openSlides({
      slides: { a: [picture({ src: "media/logo.svg" })] },
      edit: (deck) => {
        deck.marp = true;
      },
    });
    fireEvent.doubleClick(box("pic"));
    expect(view.onError).toHaveBeenCalledWith(
      "media/logo.svg did not come in with the deck. Import the deck's folder to bring it in, then try again.",
    );
  });
});

// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createFile, type SlideFile } from "../../packages/core/src";
import { CastReceiver } from "../../apps/web/src/cast-receiver";
import { CAST_NAMESPACE, castFrame, frameChunks } from "../../apps/web/src/editors/slide-cast-protocol";
import { startOfShow } from "../../apps/web/src/editors/slide-fade-in";
import { setupSlidesDom, words } from "./slide-editor-harness";

setupSlidesDom();
vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));

it("renders only the audience slide, follows reveals and blanks, and releases the SDK listener", () => {
  let receive!: (event: { senderId: string; data: unknown }) => void;
  const context = {
    addCustomMessageListener: vi.fn((_namespace, listener) => { receive = listener; }),
    removeCustomMessageListener: vi.fn(), start: vi.fn(),
  };
  const view = render(<CastReceiver context={context} />);
  expect(screen.getByText("Ready to present with SuiteLeaf")).toBeTruthy();
  expect(context.start).toHaveBeenCalledTimes(1);
  expect(context.addCustomMessageListener).toHaveBeenCalledWith(CAST_NAMESPACE, receive);
  const deck = (createFile("slide") as SlideFile).content;
  const slide = deck.slides[deck.slideOrder[0]];
  slide.notes = "Private notes";
  slide.elements = [
    words("title", "Audience title"),
    words("point", "Revealed point", { animation: "fade-on-click" }),
    words("paragraphs", "First\nSecond", { paragraphBuilds: [{ start: 1, end: 1, order: 2 }] }),
  ];
  const frame = castFrame(deck, 0, startOfShow(0), null);
  const send = (senderId = "sender") => act(() => {
    frameChunks(JSON.stringify(frame), crypto.randomUUID()).forEach((data) => receive({ senderId, data }));
  });
  send();
  expect(screen.getByText("Audience title")).toBeTruthy();
  expect(screen.queryByText("Private notes")).toBeNull();
  const point = () => view.container.querySelector('[data-element-id="point"]');
  expect(point()?.getAttribute("data-fade")).toBe("hidden");
  expect(view.container.querySelector("style")?.textContent).toContain("data-para-index=\"1\"");
  frame.cursor.revealed = 1;
  frame.cursor.enteringId = "point";
  send();
  expect(point()?.getAttribute("data-fade")).toBe("visible");
  frame.blank = "#000000";
  send("another sender");
  expect(view.container.querySelector<HTMLElement>(".cast-blank")?.style.backgroundColor).toBe("rgb(0, 0, 0)");
  frame.blank = null;
  frame.page = { width: 960, height: 540, document: "<p>MARP</p>", plain: "<p>MARP</p>" };
  send();
  expect(view.container.querySelector(".cast-blank")).toBeNull();
  view.unmount();
  expect(context.removeCustomMessageListener).toHaveBeenCalledWith(CAST_NAMESPACE, receive);
});

it("explains receiver SDK failure", () => {
  render(<CastReceiver />);
  expect(screen.getByText("Google Cast is unavailable.")).toBeTruthy();
});

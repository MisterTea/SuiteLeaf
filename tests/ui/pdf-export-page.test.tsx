// @vitest-environment jsdom
import { act, fireEvent, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFile,
  serializeFile,
  type Presentation,
  type SlideFile,
} from "../../packages/core/src";

const fake = vi.hoisted(() => ({
  marp: null as null | { pages: { document: string; width: number; height: number }[] },
  prepare: vi.fn<(doc: Document) => Promise<void>>(async () => {}),
  printFrame: null as null | { loaded?: boolean; renderError?: string },
  box: { x: 0, y: 0, width: 960, height: 540 },
  disposed: 0,
}));

vi.mock("../../apps/web/src/editors/slide-marp-runtime", () => ({
  prepareMarpDocument: fake.prepare,
}));
vi.mock("../../apps/web/src/editors/slide-fonts", () => ({
  loadEmbeddedFonts: async () => {},
}));
vi.mock("../../apps/web/src/editors/slide-marp-render", () => ({
  renderMarpPages: () =>
    fake.marp ? { ...fake.marp, dispose: () => fake.disposed++ } : null,
}));
vi.mock("../../apps/web/src/editors/slide-print", () => ({
  SlidePrintDeck: ({ deck }: { deck: Presentation }) => (
    <div className="slides-print-deck marp-print-deck">
      {deck.slideOrder
        .filter((id) => !deck.slides[id]?.hidden)
        .map((id) => (
          <div key={id} className="slides-print-page">
            <img alt="" />
          </div>
        ))}
      {fake.printFrame ? (
        <iframe
          title="print"
          data-loaded={fake.printFrame.loaded ? "true" : undefined}
          data-render-error={fake.printFrame.renderError}
        />
      ) : null}
    </div>
  ),
}));
vi.mock("../../apps/web/src/editors/slide-surface", () => ({
  SlideStill: ({ index }: { index: number }) => <img alt={`still ${index}`} />,
}));
vi.mock("../../apps/web/src/style.css", () => ({}));

type Bridge = NonNullable<Window["suiteleafPdf"]>;
const host = {
  pdf: (() => {}) as (json: string) => void,
  png: (() => {}) as (json: string) => void,
  next: () => {},
  ready: vi.fn(),
  fail: vi.fn(),
  pngFail: vi.fn(),
  slide: vi.fn(),
};

function deck(count: number, hidden: number[] = []) {
  const file = createFile("slide", "Deck") as SlideFile;
  const template = file.content.slides[file.content.slideOrder[0]];
  file.content.slideOrder = [];
  file.content.slides = {};
  for (let i = 0; i < count; i++) {
    const id = `s${i}`;
    file.content.slideOrder.push(id);
    file.content.slides[id] = { ...template, id, hidden: hidden.includes(i) };
  }
  return serializeFile(file);
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("requestAnimationFrame", (done: FrameRequestCallback) =>
    setTimeout(() => done(performance.now()), 0),
  );
  HTMLImageElement.prototype.decode = async () => {};
  Element.prototype.getBoundingClientRect = function () {
    return { ...fake.box, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} } as DOMRect;
  };
  window.suiteleafPdf = {
    listen: (callback) => (host.pdf = callback),
    listenPng: (callback) => (host.png = callback),
    onPngNext: (callback) => (host.next = callback),
    ready: host.ready,
    fail: host.fail,
    pngFail: host.pngFail,
    slide: host.slide,
  } satisfies Bridge;
  await act(async () => {
    await import("../../apps/web/src/pdf-export");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  fake.marp = null;
  fake.printFrame = null;
  fake.box = { x: 0, y: 0, width: 960, height: 540 };
  fake.prepare.mockResolvedValue(undefined);
});

const send = (to: (json: string) => void, json: string) => act(() => to(json));

describe("PDF export page", () => {
  it("draws the visible slides and tells the host it can print", async () => {
    await send(host.pdf, deck(3, [1]));
    await waitFor(() => expect(host.ready).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll(".slides-print-page")).toHaveLength(2);
    expect(host.fail).not.toHaveBeenCalled();
  });

  it("refuses files that are not presentations", async () => {
    await send(host.pdf, serializeFile(createFile("doc", "Doc")));
    expect(host.fail).toHaveBeenCalledWith("Only a presentation can be exported as PDF.");
    await send(host.pdf, "{not json");
    expect(host.fail).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".slides-print-deck")).toBeNull();
  });

  it("waits for embedded MARP slides and reports one that failed to draw", async () => {
    fake.printFrame = { loaded: true };
    await send(host.pdf, deck(1));
    await waitFor(() => expect(host.ready).toHaveBeenCalled());
    expect(fake.prepare).toHaveBeenCalled();

    fake.printFrame = { renderError: "Bad theme" };
    await send(host.pdf, deck(1));
    await waitFor(() => expect(host.fail).toHaveBeenCalledWith("Bad theme"));
  });
});

describe("PNG export page", () => {
  it("shows one slide at a time and reports where it is", async () => {
    fake.box = { x: 0, y: 0, width: 960.4, height: 540 };
    await send(host.png, deck(2));
    await waitFor(() =>
      expect(host.slide).toHaveBeenCalledWith({ index: 0, x: 0, y: 0, width: 960.4, height: 540, count: 2 }),
    );
    expect(document.querySelector(".slides-png-frame")?.getAttribute("data-export-index")).toBe("0");
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("still 0");
    await act(() => host.next());
    await waitFor(() => expect(host.slide).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1 })));
    await act(() => host.next());
    expect(host.slide).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".slides-png-frame")?.getAttribute("data-export-index")).toBe("1");
  });

  it("fails when the slide has no size or the file is not a presentation", async () => {
    fake.box = { x: 0, y: 0, width: 0, height: 0 };
    await send(host.png, deck(1));
    await waitFor(() => expect(host.pngFail).toHaveBeenCalledWith("The slide did not finish drawing."));
    await send(host.png, serializeFile(createFile("sheet", "S")));
    expect(host.pngFail).toHaveBeenLastCalledWith("Only a presentation can be exported as PNG.");
  });

  it("captures a MARP slide after its frame has loaded", async () => {
    fake.marp = { pages: [{ document: "<p>One</p>", width: 1280, height: 720 }] };
    await send(host.png, deck(1));
    const frame = document.querySelector<HTMLIFrameElement>(".slides-png-frame iframe")!;
    expect(frame.title).toBe("Slide 1");
    expect(document.querySelector<HTMLElement>(".slides-png-frame")!.style.width).toBe("1280px");
    fireEvent.load(frame);
    await waitFor(() => expect(host.slide).toHaveBeenCalledWith(expect.objectContaining({ index: 0, count: 1 })));
    expect(frame.dataset.loaded).toBe("true");
  });

  it("reports a MARP slide whose frame failed to prepare", async () => {
    fake.marp = { pages: [{ document: "<p>Two</p>", width: 1280, height: 720 }] };
    fake.prepare.mockRejectedValueOnce(new Error("Math failed"));
    await send(host.png, deck(1));
    fireEvent.load(document.querySelector(".slides-png-frame iframe")!);
    await waitFor(() => expect(host.pngFail).toHaveBeenCalledWith("Math failed"));
  });

  it("switches back to PDF output after a PNG job", async () => {
    await send(host.png, deck(1));
    await send(host.pdf, deck(1));
    await waitFor(() => expect(host.ready).toHaveBeenCalled());
    expect(document.querySelector(".slides-png-frame")).toBeNull();
  });
});

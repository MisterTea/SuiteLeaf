// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createFile } from "../../packages/core/src";
import {
  SlidePrintDeck,
  useSlidePrint,
} from "../../apps/web/src/editors/slide-print";
import { croppedPictureStyle } from "../../apps/web/src/editors/slide-surface";
vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */",
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("prints every slide in deck order with its background and page number", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const first = file.content.slides[file.content.slideOrder[0]];
  const words = (content: string) => [
    { id: `${content}-words`, type: "text" as const, x: 40, y: 40, width: 400, height: 80, content },
  ];
  file.content.slides = {
    a: { ...first, id: "a", title: "First", elements: words("First"), background: { color: "#ff0000" } },
    b: { ...first, id: "b", title: "Second", elements: words("Second") },
  };
  file.content.slideOrder = ["b", "a"];
  file.content.slideNumbers = true;
  const view = render(<SlidePrintDeck active deck={file.content} />);
  const pages = [
    ...document.querySelectorAll<HTMLElement>(".slides-print-page"),
  ];
  expect(pages.map((page) => page.querySelector(".slide-text")?.textContent)).toEqual([
    "Second",
    "First",
  ]);
  expect(
    pages.map((page) => page.querySelector(".slide-number")?.textContent),
  ).toEqual(["1", "2"]);
  expect(pages[1].style.backgroundColor).toBe("rgb(255, 0, 0)");
  file.content.slides.a.hidden = true;
  view.rerender(<SlidePrintDeck active deck={file.content} />);
  expect(
    [...document.querySelectorAll(".slides-print-page")].map(
      (page) => page.querySelector(".slide-text")?.textContent,
    ),
  ).toEqual(["Second"]);
  view.rerender(
    <SlidePrintDeck active={false} deck={file.content} />,
  );
  expect(document.querySelector(".slides-print-deck")).toBeNull();
});
it("offsets a picture crop with top, which follows the box height", () => {
  const style = croppedPictureStyle({
    id: "pic",
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    cropLeft: 8.931,
    cropTop: 30.048,
    cropRight: 9.259,
    cropBottom: 24.141,
  });
  const scaleY = 1 / (1 - 0.30048 - 0.24141);
  expect(parseFloat(style?.top || "")).toBeCloseTo(-0.30048 * scaleY * 100, 6);
  expect(parseFloat(style?.height || "")).toBeCloseTo(scaleY * 100, 6);
  expect(style).not.toHaveProperty("marginTop");
});
it("prepares the deck for native beforeprint and releases it afterprint", () => {
  const { result } = renderHook(() => useSlidePrint("Deck", vi.fn()));
  expect(result.current.printing).toBe(false);
  act(() => window.dispatchEvent(new Event("beforeprint")));
  expect(result.current.printing).toBe(true);
  act(() => window.dispatchEvent(new Event("afterprint")));
  expect(result.current.printing).toBe(false);
});
it("cleans up the print surface when a native print request fails", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
    setTimeout(callback, 0),
  );
  const send = vi.fn().mockRejectedValue(new Error("Printer unavailable"));
  const { result } = renderHook(() => useSlidePrint("Deck", send));
  await act(async () => {
    await expect(result.current.print()).rejects.toThrow("Printer unavailable");
  });
  expect(send).toHaveBeenCalledWith("Deck");
  expect(result.current.printing).toBe(false);
});

it("keeps source HTML, SVG and page-specific Marp CSS in isolated print pages", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  file.content.marp = true;
  file.content.marpSource = `---
marp: true
---
# First
<div class="chart"><svg viewBox="0 0 10 10"><circle r="4" cx="5" cy="5" /></svg></div>

---
<!-- backgroundColor: black -->
# Second
<script>window.untrusted = true</script>`;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    { id: "lossy", type: "text", x: 40, y: 40, width: 400, height: 80, content: "Lossy boxes" },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const frames = [
    ...document.querySelectorAll<HTMLIFrameElement>(".marp-print-deck iframe"),
  ];
  expect(frames).toHaveLength(2);
  expect(frames[0].getAttribute("sandbox")).toBe(
    "allow-same-origin allow-scripts",
  );
  expect(frames[0].srcdoc).toContain('class="chart"');
  expect(frames[1].srcdoc).not.toContain("window.untrusted");
  expect(frames[0].srcdoc).toContain("<circle");
  expect(frames[1].srcdoc).toContain(
    '<div class="marpit"><svg style="display:none"></svg><svg',
  );
  expect(frames[1].srcdoc).toContain("background-color:black");
  expect(document.body.textContent).not.toContain("Lossy boxes");
});

it("prints current canvas content when direct edits supersede the retained Marp source", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  file.content.marp = true;
  file.content.marpSource = "# Old source";
  file.content.marpSourceDirty = true;
  file.content.slides[file.content.slideOrder[0]].elements = [
    { id: "edited", type: "text", x: 40, y: 40, width: 400, height: 80, content: "Edited content" },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  expect(document.body.textContent).toContain("Edited content");
  expect(document.querySelector(".marp-print-deck")).toBeNull();
});

it("preserves compiled companion pagination while stripping authored scripts and handlers", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  file.content.marp = true;
  file.content.marpSource = "# Raw source";
  const html =
    '<style>section{background:navy}</style><div id="source-container" class="marpit"><svg data-marpit-svg="" viewBox="0 0 1280 720"><foreignObject width="1280" height="720"><section><p onclick="window.untrusted=true">Processed content</p><script>window.untrusted=true</script></section></foreignObject></svg></div>';
  file.content.marpAssets = {
    "@marp/compiled.html": `data:text/html;base64,${btoa(html)}`,
  };
  render(
    <SlidePrintDeck active deck={file.content} />,
  );
  const frame = document.querySelector<HTMLIFrameElement>(
    ".marp-print-deck iframe",
  )!;
  expect(frame.srcdoc).toContain("Processed content");
  expect(frame.srcdoc).toContain('id="source-container"');
  expect(frame.srcdoc).toContain("background:navy");
  expect(frame.srcdoc).not.toContain("Raw source");
  expect(frame.srcdoc).not.toContain("window.untrusted");
});

it("releases embedded asset URLs after the print surface closes", () => {
  const create = vi.fn(() => "blob:print-image");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  file.content.marp = true;
  file.content.marpSource = "# Picture\n\n![](plot.svg)";
  file.content.marpAssets = {
    "plot.svg": `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')}`,
  };
  const view = render(
    <SlidePrintDeck active deck={file.content} />,
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(document.querySelector("iframe")!.srcdoc).toContain(
    'src="blob:print-image"',
  );
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:print-image");
});

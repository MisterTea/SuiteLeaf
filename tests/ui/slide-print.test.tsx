// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createFile } from "../../packages/core/src";
import { readAppStyle } from "../app-style";
import {
  SlidePrintDeck,
  printPageBackground,
  useSlidePrint,
} from "../../apps/web/src/editors/slide-print";
import { croppedPictureStyle, intersectsSlide } from "../../apps/web/src/editors/slide-surface";
vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */",
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("clips a picture that hangs off the slide instead of omitting it from print", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "hang",
      type: "image",
      x: 12,
      y: -30,
      width: 320,
      height: 220,
      src: "data:image/png;base64,AAAA",
      alt: "Hanging photograph",
      cropTop: 10,
    },
    {
      id: "inside",
      type: "image",
      x: 40,
      y: 40,
      width: 80,
      height: 60,
      src: "data:image/png;base64,BBBB",
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const images = [...document.querySelectorAll<HTMLElement>(".slides-print-deck .slide-image")];
  expect(images).toHaveLength(2);
  expect(images[0].style.top).toBe("0px");
  expect(parseFloat(images[0].style.height)).toBeCloseTo(220 - 30, 4);
  const photo = images[0].querySelector("img");
  expect(photo?.getAttribute("alt")).toBe("Hanging photograph");
  expect(photo?.style.clipPath.startsWith("inset(")).toBe(true);
  expect(images[1].style.top).toBe("40px");
});

it("leaves a picture that hangs off the slide and drops a box parked fully outside it", () => {
  expect(intersectsSlide({ x: -2, y: 10, width: 100, height: 40 }, 960, 720)).toBe(true);
  expect(intersectsSlide({ x: 1066, y: 791, width: 4, height: 4 }, 960, 720)).toBe(false);
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    { id: "on", type: "text", x: 40, y: 40, width: 200, height: 40, content: "On the slide" },
    {
      id: "parked",
      type: "text",
      x: 1066,
      y: 791,
      width: 4,
      height: 4,
      content: "To change footer",
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  expect(document.body.textContent).toContain("On the slide");
  expect(document.body.textContent).not.toContain("To change footer");
});

it("keeps a section numeral whose box starts above the slide", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "numeral",
      type: "text",
      x: 20,
      y: -48,
      width: 220,
      height: 360,
      content: "4",
      fontSize: 200,
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const box = document.querySelector<HTMLElement>(".slides-print-deck .slide-text");
  expect(box?.textContent).toBe("4");
  expect(box?.style.top).toBe("0px");
  expect(box?.style.overflow).toBe("hidden");
  expect(parseFloat(box?.style.height || "")).toBeCloseTo(360 - 48, 4);
  const shift = box?.querySelector<HTMLElement>(".slide-text-shift");
  expect(shift?.style.top).toBe(`${(-48 / (360 - 48)) * 100}%`);
});

it("stacks upright vertical text one letter per line", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "banner",
      type: "text",
      x: 80,
      y: 40,
      width: 48,
      height: 280,
      content: "IMPACTS",
      fontSize: 32,
      bold: true,
      textFlow: "upright",
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const box = document.querySelector<HTMLElement>(".slide-text");
  expect(box?.style.writingMode).toBe("vertical-lr");
  expect(box?.style.textOrientation).toBe("upright");
  expect(box?.textContent).toBe("IMPACTS");
});

it("paints an opaque gradient ellipse with its own SVG gradient", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  const fill = "linear-gradient(90deg, #69c1ec 0%, #bbe5ff 100%)";
  slide.elements = [
    {
      id: "oval-a",
      type: "shape",
      shapeType: "ellipse",
      x: 40,
      y: 40,
      width: 200,
      height: 120,
      fill,
    },
    {
      id: "oval-b",
      type: "shape",
      shapeType: "ellipse",
      x: 280,
      y: 40,
      width: 160,
      height: 100,
      fill: "linear-gradient(180deg, #f4b183 0%, #c65911 100%)",
    },
    {
      id: "solid",
      type: "shape",
      shapeType: "ellipse",
      x: 480,
      y: 40,
      width: 80,
      height: 80,
      fill: "#5b9bd5",
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const ellipses = [...document.querySelectorAll("ellipse")];
  expect(ellipses.map((node) => node.getAttribute("fill"))).toEqual([
    "url(#slf-oval-a)",
    "url(#slf-oval-b)",
    "#5b9bd5",
  ]);
  const gradients = [...document.querySelectorAll("linearGradient")];
  expect(gradients.map((node) => node.id)).toEqual(["slf-oval-a", "slf-oval-b"]);
  expect(gradients[0].innerHTML).toContain("#69c1ec");
  expect(document.body.innerHTML).not.toContain('fill="linear-gradient');
});

it("does not stack a transparent gradient on the print page", () => {
  const fade = "linear-gradient(180deg, #3789de 0%, rgba(255, 255, 255, 0) 100%)";
  expect(printPageBackground(fade, "#ffffff")).toBe("#ffffff");
  expect(printPageBackground("#112233")).toBe("#112233");
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
it("prints an audio clip as its poster instead of a blank control", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "clip",
      type: "audio",
      x: 400,
      y: 200,
      width: 48,
      height: 48,
      src: "data:audio/mpeg;base64,AAA",
      poster: "data:image/png;base64,AAAA",
      alt: "Narration",
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const still = document.querySelector(".slide-video-still img");
  expect(still?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  expect(document.querySelector(".slide-audio")).toBeNull();
  expect(document.querySelector(".slide-media-play")).toBeNull();
});
it("prints a cropped video poster without the player frame", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "clip",
      type: "video",
      x: 40,
      y: 80,
      width: 400,
      height: 220,
      src: "data:video/mp4;base64,AAA",
      poster: "data:image/png;base64,AAAA",
      alt: "Simulation",
      cropLeft: 9.48,
      cropTop: 3.97,
      cropRight: 5.643,
      cropBottom: 5.087,
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const frameStyle = document.querySelector(".slide-video-still")?.getAttribute("style") || "";
  expect(frameStyle).toMatch(/background:\s*transparent/);
  expect(frameStyle).toMatch(/border-width:\s*0/);
  expect(frameStyle).toMatch(/overflow:\s*hidden/);
  const still = document.querySelector(".slide-video-still img");
  expect(still?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  const style = still?.getAttribute("style") || "";
  expect(style).toMatch(/object-fit:\s*fill/);
  expect(style).toMatch(/clip-path:\s*inset\(/);
  expect(document.querySelector(".slide-media-play")).toBeNull();
});
it("prints a rotated video poster inside the turned frame", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "clip",
      type: "video",
      x: 400,
      y: 80,
      width: 320,
      height: 180,
      rotation: 90,
      src: "data:video/mp4;base64,AAA",
      poster: "data:image/png;base64,AAAA",
      alt: "Wake rake",
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  expect(document.querySelector(".slide-video-still img")).toBeNull();
  const image = document.querySelector(".slide-video-still image");
  expect(image?.getAttribute("href")).toBe("data:image/png;base64,AAAA");
  const turn = document.querySelector(".slide-video-still g")?.getAttribute("transform") || "";
  expect(turn).toMatch(/^rotate\(90 /);
  const frame = document.querySelector(".slide-video-still")?.getAttribute("style") || "";
  expect(frame).toMatch(/overflow:\s*hidden/);
  expect(frame).not.toMatch(/rotate\(90deg\)/);
});
it("prints a merged table header across the rows it covers", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "grid",
      type: "table",
      x: 40,
      y: 40,
      width: 400,
      height: 120,
      rows: [
        ["Quantity", "Factor"],
        ["Value"],
      ],
      cellMarks: [
        [{ rowSpan: 2 }, {}],
        [{}, ],
      ],
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const cells = [...document.querySelectorAll(".slide-table td")];
  expect(cells.map((cell) => cell.textContent)).toEqual(["Quantity", "Factor", "Value"]);
  expect(cells[0].getAttribute("rowspan")).toBe("2");
  expect(cells[1].getAttribute("rowspan")).toBeNull();
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

it("wraps an unbroken table token inside the cell", () => {
  const block = readAppStyle().match(/\.slide-table td \{[^}]+\}/)?.[0];
  expect(block).toContain("white-space: pre-wrap");
  expect(block).toContain("overflow-wrap: anywhere");
});

it("paints a quarter-turned bar in the rotated frame instead of the tall box", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const height = file.content.height || 540;
  const id = file.content.slideOrder[0];
  file.content.slides[id].elements = [
    {
      id: "bar",
      type: "shape",
      shapeType: "rect",
      x: 400,
      y: 20,
      width: 40,
      height: 900,
      rotation: 90,
      fill: "#76923c",
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const shape = document.querySelector<HTMLElement>(".slide-shape");
  expect(shape).toBeTruthy();
  // Center (420, 470), quarter turn, 40px tall. The pre-turn top is 20.
  expect(parseFloat(shape!.style.top)).toBeCloseTo((450 / height) * 100, 4);
  expect(parseFloat(shape!.style.height)).toBeCloseTo((40 / height) * 100, 4);
  expect(shape!.style.transform).toBe("");
  const rect = shape!.querySelector("rect");
  expect(rect?.getAttribute("fill")).toBe("#76923c");
  expect(rect?.getAttribute("transform") ?? shape!.querySelector("g")?.getAttribute("transform")).toContain(
    "rotate(90",
  );
});

it("keeps a centered print face content-sized so flex can place it", () => {
  const css = readAppStyle();
  const rule = css.match(
    /\.slides-print-deck \.slide-text\[data-valign="middle"\] \.slide-text-face[\s\S]*?\}/,
  )?.[0];
  expect(rule).toContain("min-height: 0");
  expect(rule).toContain("flex-shrink: 0");
});

it("feathers a filled shape on every side when the slide stores a soft edge", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const id = file.content.slideOrder[0];
  file.content.slides[id].elements = [
    {
      id: "glow",
      type: "shape",
      shapeType: "rect",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      fill: "#ffffff",
      softEdge: 40,
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const shape = document.querySelector<HTMLElement>(".slide-shape");
  expect(shape?.style.maskImage).toContain("linear-gradient");
  expect(shape?.style.maskImage).toContain("min(calc(40px * var(--canvas-fit, 1)), 49%)");
  expect(shape?.style.maskComposite).toBe("intersect");
});

it("feathers a picture on every side when the slide stores a soft edge", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const id = file.content.slideOrder[0];
  file.content.slides[id].elements = [
    {
      id: "photo",
      type: "image",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      src: "data:image/png;base64,aaaa",
      softEdge: 50,
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const picture = document.querySelector<HTMLElement>(".slide-image");
  expect(picture?.style.maskImage).toContain("linear-gradient");
  expect(picture?.style.maskImage).toContain("min(calc(50px * var(--canvas-fit, 1)), 49%)");
  expect(picture?.style.maskComposite).toBe("intersect");
});

it("rotates a picture inside its clip frame so print keeps the photo", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const id = file.content.slideOrder[0];
  file.content.slides[id].elements = [
    {
      id: "photo",
      type: "image",
      x: 400,
      y: 0,
      width: 500,
      height: 520,
      rotation: 90,
      cropLeft: 3,
      cropRight: 20,
      src: "data:image/jpeg;base64,aaaa",
      alt: "Rotated photo",
    },
  ];
  render(<SlidePrintDeck active deck={file.content} />);
  const picture = document.querySelector<HTMLElement>(".slide-image");
  expect(picture?.style.transform).toBe("");
  expect(picture?.style.left).toBe(`${(390 / 960) * 100}%`);
  expect(picture?.style.top).toBe(`${(10 / 540) * 100}%`);
  expect(picture?.style.width).toBe(`${(520 / 960) * 100}%`);
  expect(picture?.style.height).toBe(`${(500 / 540) * 100}%`);
  expect(picture?.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 520 500");
  const turned = picture?.querySelector("g");
  expect(turned?.getAttribute("transform")).toBe("rotate(90 260 250)");
  const shape = turned?.querySelector("svg");
  expect(shape?.getAttribute("width")).toBe("500");
  expect(shape?.getAttribute("height")).toBe("520");
  expect(picture?.querySelector("image")?.getAttribute("href")).toContain("data:image/jpeg");
});

it("prints speaker notes under a visible slide and leaves a hidden slide out", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const first = file.content.slides[file.content.slideOrder[0]];
  file.content.slides = {
    shown: {
      ...first,
      id: "shown",
      notes: "Water <the> beds",
      elements: [{ id: "title", type: "text", x: 0, y: 0, width: 10, height: 10, content: "North" }],
    },
    hidden: {
      ...first,
      id: "hidden",
      hidden: true,
      notes: "secret-value",
      elements: [{ id: "secret", type: "text", x: 0, y: 0, width: 10, height: 10, content: "secret-value" }],
    },
  };
  file.content.slideOrder = ["hidden", "shown"];
  render(<SlidePrintDeck active deck={file.content} />);
  const notes = [...document.querySelectorAll(".slides-print-notes")].map((node) => node.textContent);
  expect(notes).toEqual(["Water <the> beds"]);
  expect(document.body.textContent).not.toContain("secret-value");
  expect(document.querySelector(".slides-print-notes")?.innerHTML).toBe("Water &lt;the&gt; beds");
  const sheet = document.querySelector(".slides-print-sheet");
  expect(sheet?.querySelector(".slides-print-page .slides-print-notes")).toBeNull();
  expect(sheet?.querySelector(":scope > .slides-print-notes")?.textContent).toBe("Water <the> beds");
  const css = readAppStyle();
  expect(css).toContain(".slides-print-deck .slides-print-sheet {\n    break-after: page;");
  expect(css).toContain(".slides-print-deck .slides-print-page {\n    overflow: hidden;");
  expect(css).toContain(".slides-print-deck .slides-print-notes {\n    /* A slide PDF is one page.");
  expect(css).toContain("display: none !important;");
  expect(file.content.slides.hidden.notes).toBe("secret-value");
  expect(file.content.slides.shown.notes).toBe("Water <the> beds");
});

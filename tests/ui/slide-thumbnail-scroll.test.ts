// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { scrollThumbnailIntoView } from "../../apps/web/src/editors/slide-thumbnail-scroll";

afterEach(() => {
  document.body.innerHTML = "";
});

function setup(horizontal: boolean, start: number, end: number) {
  const page = document.createElement("div");
  const strip = document.createElement("div");
  const item = document.createElement("div");
  page.append(strip);
  strip.append(item);
  document.body.append(page);
  page.scrollTop = 80;
  strip.style.flexDirection = horizontal ? "row" : "column";
  strip.scrollTop = 40;
  strip.scrollLeft = 60;
  const rect = (left: number, top: number, right: number, bottom: number) =>
    ({
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    }) as DOMRect;
  strip.getBoundingClientRect = () => rect(20, 100, 320, 500);
  Object.defineProperties(strip, {
    clientWidth: { value: 300 },
    clientHeight: { value: 400 },
  });
  item.getBoundingClientRect = () =>
    horizontal ? rect(start, 100, end, 180) : rect(20, start, 120, end);
  return { page, strip, item };
}

it("reveals a thumbnail to the right without moving the editor's ancestors", () => {
  const { page, strip, item } = setup(true, 400, 480);
  scrollThumbnailIntoView(strip, item);
  expect(strip.scrollLeft).toBe(220);
  expect(strip.scrollTop).toBe(40);
  expect(page.scrollTop).toBe(80);
});

it("reveals a thumbnail to the left and leaves an already-visible one alone", () => {
  const { strip, item } = setup(true, -20, 60);
  scrollThumbnailIntoView(strip, item);
  expect(strip.scrollLeft).toBe(20);
  item.getBoundingClientRect = () => ({ left: 40, right: 120 }) as DOMRect;
  scrollThumbnailIntoView(strip, item);
  expect(strip.scrollLeft).toBe(20);
});

it("scrolls only the desktop sidebar when a thumbnail is below or above it", () => {
  const { page, strip, item } = setup(false, 550, 650);
  scrollThumbnailIntoView(strip, item);
  expect(strip.scrollTop).toBe(190);
  item.getBoundingClientRect = () => ({ top: 20, bottom: 80 }) as DOMRect;
  scrollThumbnailIntoView(strip, item);
  expect(strip.scrollTop).toBe(110);
  expect(strip.scrollLeft).toBe(60);
  expect(page.scrollTop).toBe(80);
});

it("does not shift a thumbnail that already spans the visible region", () => {
  const { strip, item } = setup(false, 50, 600);
  scrollThumbnailIntoView(strip, item);
  expect(strip.scrollTop).toBe(40);
});

it("accepts an unmounted strip or a removed slide", () => {
  const { strip, item } = setup(true, 400, 480);
  scrollThumbnailIntoView(null, item);
  scrollThumbnailIntoView(strip, null);
  expect(strip.scrollLeft).toBe(60);
});

// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createFile, parseFile, type SlideFile } from "../../packages/core/src";
import { SlideMediaControls } from "../../apps/web/src/editors/slide-media";

afterEach(cleanup);

it("keeps a caption on the clip and leaves the media bytes out of the track", () => {
  const file = createFile("slide") as SlideFile;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements = [
    {
      id: "clip",
      type: "video",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      src: "data:video/mp4;base64,secret-value",
      caption: "North beds",
    },
  ];
  const opened = parseFile(JSON.stringify(file));
  if (opened.kind !== "slide") throw new Error("expected slides");
  const saved = opened.content.slides[opened.content.slideOrder[0]].elements[0];
  expect(saved.caption).toBe("North beds");
  render(<SlideMediaControls element={saved} />);
  const track = document.querySelector("track");
  expect(track?.getAttribute("src")).toContain("North%20beds");
  expect(track?.getAttribute("src")).not.toContain("secret-value");
  expect(document.body.textContent).not.toContain("secret-value");
});

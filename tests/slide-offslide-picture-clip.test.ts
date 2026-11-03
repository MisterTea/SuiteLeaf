import { expect, it } from "vitest";
import type { SlideElement } from "../packages/core/src";
import {
  clipPictureToSlide,
  translateClipPath,
} from "../apps/web/src/editors/slide-picture-crop";

it("keeps an off-slide ellipse clip on the visible part of the picture", () => {
  const photo: SlideElement = {
    id: "sky",
    type: "image",
    x: 400,
    y: -40,
    width: 700,
    height: 620,
    src: "data:image/png;base64,AAAA",
    cropLeft: -7.4,
    cropRight: 54.8,
    clipPath: "M 350 0 A 350 310 0 1 1 350 620 A 350 310 0 1 1 350 0 Z",
  };
  const clipped = clipPictureToSlide(photo, 960, 540);
  expect(clipped.x).toBe(400);
  expect(clipped.y).toBe(0);
  expect(clipped.width).toBe(560);
  expect(clipped.height).toBe(540);
  expect(clipped.clipPath).toBe(
    "M 350 -40 A 350 310 0 1 1 350 580 A 350 310 0 1 1 350 -40 Z",
  );
  const inside = { ...photo, y: 20, height: 200 };
  expect(clipPictureToSlide(inside, 960, 540).clipPath).toBe(photo.clipPath);
});

it("translates absolute path positions and leaves radii and relative segments", () => {
  expect(translateClipPath("M 10 20 L 30 40 Z", -5, 8)).toBe("M 5 28 L 25 48 Z");
  expect(translateClipPath("M 0 0 c 10 0 10 20 0 20", 4, 4)).toBe(
    "M 4 4 c 10 0 10 20 0 20",
  );
  expect(translateClipPath("M 0 0 H 12 V 8", 1, 2)).toBe("M 1 2 H 13 V 10");
  expect(translateClipPath("M 0 0 C 1 2 3 4 5 6", 10, -2)).toBe(
    "M 10 -2 C 11 0 13 2 15 4",
  );
  expect(translateClipPath("M 0 0 Q 4 6 8 0", 1, 1)).toBe("M 1 1 Q 5 7 9 1");
  expect(translateClipPath("broken", 1, 2)).toBe("broken");
  expect(translateClipPath("M 1", 3, 4)).toBe("M 1");
  expect(translateClipPath("M 1 2", 0, 0)).toBe("M 1 2");
});

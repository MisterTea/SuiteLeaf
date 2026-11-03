import { expect, it } from "vitest";
import { presentationSlidePath, slideAtAddress } from "../apps/web/src/slide-location";

it("names the open slide in the address and falls back to the first", () => {
  expect(presentationSlidePath("deck", "slide-2")).toBe("/file/deck/slide-2");
  expect(slideAtAddress(["slide-1", "slide-2"], "slide-2")).toBe("slide-2");
  expect(slideAtAddress(["slide-1", "slide-2"], undefined)).toBe("slide-1");
  expect(slideAtAddress(["slide-1", "slide-2"], "missing")).toBe("slide-1");
});

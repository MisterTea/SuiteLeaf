import { expect, it } from "vitest";
import { autofitPointSize } from "../packages/core/src/pptx-autofit";

it("quantizes reduced point sizes once while retaining unscaled authored fractions", () => {
  expect(autofitPointSize(28, 0.925)).toBe(26);
  expect(autofitPointSize(44, 0.9)).toBe(40);
  expect(autofitPointSize(19, 0.9734)).toBe(19);
  expect(autofitPointSize(33, 0.625)).toBe(21);
  expect(autofitPointSize(28.5, 1)).toBe(28.5);
  expect(autofitPointSize(10.5, 1.5)).toBe(15.75);
  expect(autofitPointSize(20, 0.5)).toBe(10);
});

// @vitest-environment jsdom
import { expect, it } from "vitest";
import { selectSourceRange, setSourceScrollTop, sourceEditor, sourceHeight, sourceScrollTop, sourceSelection, sourceValue } from "../../apps/web/src/editors/slide-source-control";

it("supports a native source textarea's selection, text and scroll geometry", () => {
  const area = document.createElement("textarea");
  area.value = "First\nSecond";
  Object.defineProperty(area, "clientHeight", { value: 120 });
  selectSourceRange(area, 6, 12, "backward");
  expect(sourceEditor(area)).toBeUndefined();
  expect(sourceValue(area)).toBe("First\nSecond");
  expect(sourceSelection(area)).toEqual({ start: 6, end: 12, backward: true });
  setSourceScrollTop(area, 42);
  expect(sourceScrollTop(area)).toBe(42);
  expect(sourceHeight(area)).toBe(120);
  selectSourceRange(area, 3);
  expect(sourceSelection(area)).toEqual({ start: 3, end: 3, backward: false });
});

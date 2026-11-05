// @vitest-environment jsdom
import { expect, it } from "vitest";
import { slideMathHtml, readSlideMath } from "../../apps/web/src/editors/slide-math";
import { runsToHtml } from "../../apps/web/src/editors/slide-runs";
import { runsFromDom } from "../../apps/web/src/editors/slide-text";
import type { TextRun } from "../../packages/core/src";
import { restoreSelection, selectionOffsets } from "../../apps/web/src/editors/slide-text";
import { semanticPoint, semanticTextLength } from "../../apps/web/src/editors/slide-text-selection";

it("retains equation text, source styles and fractions through the editable DOM", () => {
  const math: TextRun = { text: "Vp/R1", math: true, fontSize: 18, font: "SuiteLeaf Magnolia", italic: true,
    fraction: { num: [{ text: "V" }, { text: "p", script: "sub" }], den: [{ text: "R" }, { text: "1", script: "sup" }] } };
  const root = document.createElement("div");
  root.innerHTML = runsToHtml([math, { text: " = output" }]);
  expect(root.querySelector("math mfrac msub")).not.toBeNull();
  expect(root.querySelector("math mfrac msup")).not.toBeNull();
  expect(runsFromDom(root)).toEqual([math, { text: " = output" }]);
});

it("escapes mathematical text and validates semantic data instead of accepting markup", () => {
  const html = slideMathHtml({ text: '<img src=x onerror="alert(1)"> &', math: true });
  const root = document.createElement("div"); root.innerHTML = html;
  expect(root.querySelector("img")).toBeNull();
  expect(root.querySelector("math")?.textContent).toBe('<img src=x onerror="alert(1)"> &');
  expect(readSlideMath("not json")).toBeUndefined();
  expect(readSlideMath('{"math":true}')).toBeUndefined();
  expect(readSlideMath('{"text":"x","math":false}')).toBeUndefined();
});

it("uses semantic operator classes and supports empty limits without arbitrary offsets", () => {
  const root = document.createElement("div");
  root.innerHTML = slideMathHtml({ text: "a∗b= c", math: true });
  expect(root.querySelector('mo[lspace="0.222222em"]')?.textContent).toBe("∗");
  expect(root.querySelector('mo[lspace="0.277778em"]')?.textContent).toBe("=");
  expect(root.querySelector("mtext")?.textContent).toBe(" ");
  root.innerHTML = slideMathHtml({ text: "lim", math: true, fraction: { num: [], den: [{ text: "0", script: "sub" }], bar: false } });
  expect(root.querySelector("munder msub")).not.toBeNull();
});

it("keeps caret offsets after an atomic fraction in authored linear text units", () => {
  const root = document.createElement("div"); document.body.append(root);
  root.innerHTML = runsToHtml([{ text: "x " }, { text: "A/B", math: true, fraction: { num: [{ text: "A" }], den: [{ text: "B" }] } }, { text: " end" }]);
  expect(semanticTextLength(root)).toBe(9);
  restoreSelection(root, 5, 9);
  expect(selectionOffsets(root)).toEqual({ start: 5, end: 9 });
  restoreSelection(root, 2, 2);
  expect(selectionOffsets(root)).toEqual({ start: 2, end: 2 });
  expect(semanticPoint(root, 500)).toBeUndefined();
  root.innerHTML = '<span data-slide-math="bad">ordinary</span>';
  expect(semanticTextLength(root)).toBe(8);
  root.remove();
});

it("maps points after an equation and safely skips detached semantic roots", () => {
  const root = document.createElement("div");
  root.innerHTML = slideMathHtml({ text: "A/B", math: true, fraction: { num: [{ text: "A" }], den: [{ text: "B" }] } });
  expect(semanticPoint(root, 3)).toEqual({ node: root, offset: 1 });
  const atom = root.firstChild!; root.removeChild(atom);
  expect(semanticPoint(atom, 0)).toBeUndefined();
  expect(semanticPoint(document.createTextNode(""), 0)?.offset).toBe(0);
});

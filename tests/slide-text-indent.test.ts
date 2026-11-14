import { describe, expect, it } from "vitest";
import type { SlideElement } from "@suiteleaf/core";
import { indentSlideText } from "../apps/web/src/editors/slide-text-indent";
import { slideTextFormat } from "../apps/web/src/editors/slide-editor-text";
import type { SlidesEditorState } from "../apps/web/src/editors/slide-editor-state";

const box = (patch: Partial<SlideElement> = {}): SlideElement => ({
  id: "text", type: "text", x: 0, y: 0, width: 400, height: 200,
  content: "One\nTwo\nThree", ...patch,
});

describe("slide text indentation", () => {
  it("indents only the caret paragraph, including its end", () => {
    const next = indentSlideText(box(), 1, { start: 7, end: 7 });
    expect(next.content).toBe("One\nTwo\nThree");
    expect(next.runs?.filter((run) => run.paraMargin === 24).map((run) => run.text)).toEqual(["\n", "Two"]);
  });
  it("applies to touched paragraphs, excluding a selection ending at the next paragraph", () => {
    const next = indentSlideText(box(), 1, { start: 1, end: 8 });
    expect(next.runs?.filter((run) => run.paraMargin === 24).map((run) => run.text)).toEqual(["One", "\n", "Two"]);
  });
  it("indents the whole box without a text selection and can reverse it", () => {
    const original = box({ bold: true });
    const next = { ...original, ...indentSlideText(original, 1) };
    expect(next.runs?.every((run) => run.paraMargin === 24 && run.bold)).toBe(true);
    expect(indentSlideText(next, -1).runs?.every((run) => run.paraMargin === 0)).toBe(true);
    expect(indentSlideText(original, -1).runs?.every((run) => run.paraMargin === 0)).toBe(true);
  });
  it("preserves imported paragraph styles, hanging bullets, and soft breaks", () => {
    const original = box({ runs: [
      { text: "•", listMarker: true, paraMargin: 40, paraHang: 16 },
      { text: " words\nsoft", italic: true },
      { text: "\n", paragraphBreak: true, paraMargin: 80, paraHang: 20 },
      { text: "Next", color: "#123456" },
    ] });
    const next = indentSlideText(original, -1, { start: 14, end: 14 });
    expect(next.runs?.[0]).toEqual(original.runs![0]);
    expect(next.runs?.[1].text).toBe(" words\nsoft");
    expect(next.runs?.[2]).toMatchObject({ paraMargin: 56, paraHang: 20, paragraphBreak: true });
    expect(next.runs?.[3]).toMatchObject({ color: "#123456", paraMargin: 56 });
  });
  it("clamps indentation and supports empty text boxes", () => {
    expect(indentSlideText(box({ content: "", padLeft: 0 }), -1)).toEqual({ padLeft: 0 });
    expect(indentSlideText(box({ content: "" }), 1)).toEqual({ padLeft: 24 });
    expect(indentSlideText(box({ runs: [{ text: "Hi", paraMargin: 19999 }] }), 1).runs?.[0].paraMargin).toBe(20000);
    expect(indentSlideText(box(), 1, { start: 999, end: 999 }).runs?.at(-1)?.paraMargin).toBe(24);
  });
  it("uses the stored caret during editing and the whole box outside editing", () => {
    const element = box();
    const state = {
      deckRef: { current: {} },
      activeDeckSlide: () => ({ elements: [element] }),
      selectedElementRef: { current: "text" },
      editingRef: { current: "text" },
      textRange: { current: { id: "text", start: 4, end: 4 } },
    } as unknown as SlidesEditorState;
    const patches: Partial<SlideElement>[] = [];
    const tools = slideTextFormat(state, { textDeck: () => state.deckRef.current, updateElement: (_id, patch) => { patches.push(patch); } });
    tools.changeIndent(1);
    expect(patches[0].runs?.filter((run) => run.paraMargin === 24).map((run) => run.text)).toEqual(["\n", "Two"]);
    state.editingRef.current = null;
    tools.changeIndent(1);
    expect(patches[1].runs?.every((run) => run.paraMargin === 24)).toBe(true);
    state.selectedElementRef.current = null;
    tools.changeIndent(1);
    expect(patches).toHaveLength(2);
  });
});

// @vitest-environment jsdom
import { act, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { openSlides, box, pick, setupSlidesDom } from "./slide-editor-harness";
import { slideTextEditor } from "../../apps/web/src/editors/slide-tiptap-selection";
vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));
setupSlidesDom();

it("publishes text drafts and their undo to the shared slide while editing", async () => {
  const view = openSlides({ props: { collabDoc: new Y.Doc() } });
  pick("a-words");
  fireEvent.doubleClick(box("a-words").querySelector(".element-editor")!);
  await waitFor(() => expect(slideTextEditor(box("a-words").querySelector('[contenteditable="true"]')!)).toBeTruthy());
  const editor = slideTextEditor(box("a-words").querySelector('[contenteditable="true"]')!)!;
  act(() => { editor.commands.selectAll(); editor.commands.insertContent("West"); });
  expect(view.onChange.mock.lastCall?.[0].slides.a.elements[0].content).toBe("West");
  expect(view.onChange.mock.lastCall?.[1]).toMatchObject({ edited: ["a"] });
  act(() => view.slide().undo());
  expect(view.onChange.mock.lastCall?.[0].slides.a.elements[0].content).toBe("Intro");
});

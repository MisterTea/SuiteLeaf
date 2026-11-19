// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { mirrorLiveEdit } from "../../apps/web/src/collab/session";
import { seedSlideRoom } from "../../apps/web/src/collab/slide-room";
import { openSlides, setupSlidesDom, words } from "./slide-editor-harness";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));
setupSlidesDom();

const bodies = (doc: Y.Doc) =>
  [...doc.getMap<string>("slideElements").values()].map((json) => JSON.parse(json) as { content?: string; shapeType?: string });

describe("shared slide undo", () => {
  it("undoes a shape on a seeded one-slide deck and keeps the slide", () => {
    const doc = new Y.Doc();
    const editor = openSlides({
      slides: { only: [words("w", "Intro")] },
      props: {
        collabDoc: doc,
        onChange: (content, op) => mirrorLiveEdit(doc, "slide", content, op),
      },
    });
    seedSlideRoom(doc, editor.file.content);
    expect(screen.getByRole("button", { name: "Undo (Cmd+Z)" })).toBeDisabled();
    act(() => editor.slide().insertShape("rect"));
    expect(editor.elements("only").some((element) => element.shapeType === "rect")).toBe(true);
    expect(bodies(doc).some((element) => element.shapeType === "rect")).toBe(true);
    expect(screen.getByRole("button", { name: "Undo (Cmd+Z)" })).toBeEnabled();
    act(() => editor.slide().undo());
    expect(doc.getMap("slides").has("only")).toBe(true);
    expect(bodies(doc).some((element) => element.content === "Intro")).toBe(true);
    expect(bodies(doc).some((element) => element.shapeType === "rect")).toBe(false);
    expect(editor.order()).toEqual(["only"]);
    expect(editor.elements("only").some((element) => element.content === "Intro")).toBe(true);
    expect(editor.elements("only").some((element) => element.shapeType === "rect")).toBe(false);
    expect(screen.getByRole("button", { name: "Undo (Cmd+Z)" })).toBeDisabled();
    expect(editor.slide().undoReason()).toBe("Nothing to undo");
    act(() => editor.slide().undo());
    expect(doc.getMap("slides").has("only")).toBe(true);
    expect(bodies(doc).some((element) => element.content === "Intro")).toBe(true);
    expect(bodies(doc).some((element) => element.shapeType === "rect")).toBe(false);
    expect(editor.order()).toEqual(["only"]);
    expect(document.querySelector(".slides-editor")).toBeTruthy();
  });

  it("keeps the editor open when undo would remove the only shared slide", () => {
    const doc = new Y.Doc();
    const editor = openSlides({
      slides: { only: [words("w", "Intro")] },
      props: {
        collabDoc: doc,
        onChange: (content, op) => mirrorLiveEdit(doc, "slide", content, op),
      },
    });
    act(() => editor.slide().insertShape("rect"));
    expect(doc.getMap("slides").has("only")).toBe(true);
    act(() => editor.slide().undo());
    expect(doc.getMap("slides").has("only")).toBe(false);
    expect(editor.order()).toEqual(["only"]);
    expect(document.querySelector(".slides-editor")).toBeTruthy();
  });

  it("opens a deck that has no slides", () => {
    openSlides({
      edit: (deck) => {
        deck.slideOrder = [];
        deck.slides = {};
      },
    });
    expect(document.querySelector(".slides-editor")).toBeTruthy();
  });
});

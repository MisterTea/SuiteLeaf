// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorActions } from "../../apps/web/src/ui";
import { createFile } from "../../packages/core/src";
import Slides from "../../apps/web/src/editors/Slides";
import { CommandPalette } from "../../apps/web/src/command-palette";
import { DocComments, commentExtensions } from "../../apps/web/src/editors/doc-comments";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */",
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens the document's comment list from the header button, and the second press closes it", () => {
  const editor = new Editor({ extensions: [StarterKit, ...commentExtensions], content: "<p>Q3 grew 12%.</p>" });
  let toggle = () => {};
  render(
    <DocComments
      editor={editor as never}
      stageRef={{ current: null }}
      onGutter={() => {}}
      bind={(api) => {
        toggle = api.togglePanel;
      }}
    />,
  );
  expect(document.querySelector(".doc-comment-panel")).toBeNull();
  act(() => toggle());
  expect(document.querySelector(".doc-comment-panel")).not.toBeNull();
  act(() => toggle());
  expect(document.querySelector(".doc-comment-panel")).toBeNull();
  act(() => toggle());
  expect(document.querySelector(".doc-comment-panel")).not.toBeNull();
  editor.destroy();
});

it("opens the deck's comment list from the header button, and the second press closes it", () => {
  const file = createFile("slide");
  if (file.kind !== "slide") throw new Error("Expected slides");
  let actions: EditorActions | null = null;
  render(
    <CommandPalette kind="slide">
      <Slides
        file={file}
        onChange={vi.fn()}
        onError={vi.fn()}
        onActions={(next) => {
          actions = next;
        }}
      />
    </CommandPalette>,
  );
  const toggle = () => act(() => actions!.slideActions!.toggleComments!());
  expect(screen.queryByRole("region", { name: "Open comments" })).toBeNull();
  toggle();
  expect(screen.getByRole("region", { name: "Open comments" })).toBeDefined();
  toggle();
  expect(screen.queryByRole("region", { name: "Open comments" })).toBeNull();
});

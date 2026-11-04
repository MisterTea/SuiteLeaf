import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import { createFile, type Presentation, type SlideElement, type SlideFile } from "../../packages/core/src";
import Slides from "../../apps/web/src/editors/Slides";
import { CommandPalette } from "../../apps/web/src/command-palette";
import type { EditorActions } from "../../apps/web/src/ui";

/** jsdom stand-ins the slides editor needs, reset after each test. */
export function setupSlidesDom() {
  beforeEach(() => {
    // Node's own localStorage is absent unless a storage file is configured.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() {
          return store.size;
        },
      },
    });
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
    vi.restoreAllMocks();
  });
}

export const words = (id: string, content: string, extra: Partial<SlideElement> = {}): SlideElement => ({
  id,
  type: "text",
  x: 40,
  y: 40,
  width: 400,
  height: 80,
  content,
  ...extra,
});

export type OpenOptions = {
  slides?: Record<string, SlideElement[]>;
  edit?: (deck: Presentation) => void;
  readOnly?: boolean;
  fileId?: string;
  title?: string;
  props?: Partial<ComponentProps<typeof Slides>>;
};

/** Open the slides editor on slides "a", "b", "c" (or the ones given), with spies on its callbacks. */
export function openSlides({ slides, edit, readOnly = false, fileId, title, props }: OpenOptions = {}) {
  const file = createFile("slide") as SlideFile;
  if (title) file.title = title;
  const first = file.content.slides[file.content.slideOrder[0]];
  const given = slides ?? {
    a: [words("a-words", "Intro")],
    b: [words("b-words", "Plan")],
    c: [words("c-words", "Close")],
  };
  file.content.slides = Object.fromEntries(
    Object.entries(given).map(([id, elements]) => [id, { ...first, id, elements }]),
  );
  file.content.slideOrder = Object.keys(given);
  edit?.(file.content);
  const onChange = vi.fn();
  const onError = vi.fn();
  let actions: EditorActions | undefined;
  const view = render(
    <MemoryRouter>
      <CommandPalette kind="slide">
        <Slides
          file={file}
          onChange={onChange}
          onError={onError}
          onActions={(next) => (actions = next)}
          readOnly={readOnly}
          fileId={fileId}
          {...props}
        />
      </CommandPalette>
    </MemoryRouter>,
  );
  const deck = (): Presentation =>
    JSON.parse(view.container.querySelector<HTMLElement>(".slides-editor")!.dataset.deckSnapshot!);
  return {
    ...view,
    file,
    onChange,
    onError,
    actions: () => actions!,
    slide: () => actions!.slideActions! as Required<NonNullable<EditorActions["slideActions"]>>,
    deck,
    order: () => deck().slideOrder,
    active: () => document.querySelector<HTMLElement>(".thumbnail-row.active")?.dataset.slideId,
    elements: (slideId?: string) => {
      const current = deck();
      return current.slides[slideId ?? current.slideOrder[0]].elements;
    },
  };
}

export const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, ...init });

/** The box drawn for an object on the editing canvas. */
export const box = (id: string) =>
  document.querySelector<HTMLElement>(`.slide-canvas [data-element-id="${id}"]`)!;

/** Select an object on the canvas the way a click does. */
export function pick(id: string, init: MouseEventInit = {}) {
  fireEvent.mouseDown(box(id), init);
  fireEvent.mouseUp(window);
}

/** Open a toolbar menu (a Radix dropdown) and choose one of its items. */
export function choose(menu: string, item: string) {
  const trigger = screen.getByRole("button", { name: menu });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  const entry = screen.getByRole("menuitem", { name: new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
  fireEvent.click(entry);
}

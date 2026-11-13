// @vitest-environment jsdom
import { animationEntries } from "../../apps/web/src/editors/slide-animation-editing";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { parsePowerPoint } from "../../packages/core/src/pptx";
import { animationClicks } from "../../packages/core/src/slide-motion";
import { SlideFace } from "../../apps/web/src/editors/slide-face";
import { showAudienceHooks } from "../../apps/web/src/editors/slide-show-audience";

afterEach(cleanup);

it("reveals slide 33's three bullet paragraphs on separate clicks, including after going back", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", readFileSync("tests/fixtures/pptx-intro-slide33.xml", "utf8"));
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const deck = file.content;
  const slide = deck.slides[deck.slideOrder[0]];
  const body = slide.elements.find(el => el.sourceShapeId === "260" && el.type === "text")!;
  expect(body.paragraphBuilds).toEqual([
    { start: 2, end: 2, order: 1 },
    { start: 3, end: 3, order: 2 },
    { start: 4, end: 4, order: 3 },
  ]);
  expect(animationClicks(slide.elements)).toHaveLength(3);
  expect(animationEntries(slide).map(row => row.label)).toEqual([
    "▪ How did the universe originate? (paragraph 3)",
    "▪ How did life on Earth originate? (paragraph 4)",
    "▪ What is the nature of intelligence? (paragraph 5)",
  ]);
  const face = (revealed: number) => <SlideFace deck={deck} slide={slide} index={0} hooks={showAudienceHooks(slide, { slideIndex: 0, revealed, enteringId: null })} />;
  const view = render(face(0));
  await waitFor(() => expect(view.container.querySelector(".slide-tiptap-text")).not.toBeNull());
  const paragraphs = () => Array.from(view.container.querySelectorAll<HTMLElement>(`[data-element-id="${body.id}"] [data-office-paragraph]`));
  await waitFor(() => expect(paragraphs()).toHaveLength(7));
  expect(paragraphs().map(p => p.dataset.paraIndex)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  expect(paragraphs().slice(2, 5).map(p => p.textContent)).toEqual([
    "▪ How did the universe originate?", "▪ How did life on Earth originate?", "▪ What is the nature of intelligence?",
  ]);
  for (const revealed of [0, 1, 2, 3, 2, 0]) {
    view.rerender(face(revealed));
    expect(paragraphs().slice(2, 5).map(p => getComputedStyle(p).visibility)).toEqual(
      [0, 1, 2].map(index => index < revealed ? "visible" : "hidden"),
    );
    // Unanimated empty paragraphs and the title stay in the layout.
    expect(getComputedStyle(paragraphs()[0]).visibility).toBe("visible");
  }
});

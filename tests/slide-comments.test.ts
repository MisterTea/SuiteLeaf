import { describe, expect, it } from "vitest";
import { parseFile, serializeFile, type SlideFile } from "@suiteleaf/core";
import { duplicateSlides } from "../apps/web/src/editors/slide-editing";
import {
  addSlideComment,
  commentMarks,
  replyToSlideComment,
  reopenSlideComment,
  resolveSlideComment,
} from "../apps/web/src/editors/slide-comments";
import { CHART_NOTES, NEXT_NOTES, q3Update } from "./q3-comment-deck";

const options = {
  now: () => "2026-10-12T18:04:00.000Z",
  newId: (() => {
    let n = 0;
    return () => `c${++n}`;
  })(),
};

describe("slide comment threads", () => {
  it("keeps a reply under the first note and leaves speaker notes alone", () => {
    const file = q3Update();
    const slideId = file.content.slideOrder[0];
    const added = addSlideComment(
      file.content,
      slideId,
      "chart",
      "Use the September numbers",
      "Maria",
      options,
    );
    const replied = replyToSlideComment(
      added.deck,
      slideId,
      added.threadId!,
      "Priya has them.",
      "Maria",
      options,
    );
    const thread = replied.slides[slideId].comments?.[0];
    expect(thread?.messages.map((message) => message.text)).toEqual([
      "Use the September numbers",
      "Priya has them.",
    ]);
    expect(thread?.messages.map((message) => message.authorName)).toEqual([
      "Maria",
      "Maria",
    ]);
    expect(replied.slides[slideId].notes).toBe(CHART_NOTES);
    expect(replied.slides[slideId].elements).toBe(
      file.content.slides[slideId].elements,
    );
    expect(JSON.stringify(replied.slides[slideId].notes)).not.toContain(
      "September numbers",
    );
    expect(commentMarks(replied.slides[replied.slideOrder[1]])).toEqual([]);
    expect(commentMarks(replied.slides[slideId])).toHaveLength(1);
  });

  it("hides a resolved mark and puts it back on the same object", () => {
    const file = q3Update();
    const slideId = file.content.slideOrder[0];
    const added = addSlideComment(
      file.content,
      slideId,
      "chart",
      "Use the September numbers",
      "Maria",
      options,
    );
    const resolved = resolveSlideComment(
      added.deck,
      slideId,
      added.threadId!,
      "Maria",
    );
    expect(commentMarks(resolved.slides[slideId])).toEqual([]);
    expect(resolved.slides[slideId].comments?.[0].resolved).toBe(true);
    const reopened = reopenSlideComment(resolved, slideId, added.threadId!);
    const [mark] = commentMarks(reopened.slides[slideId]);
    expect(mark.element.id).toBe("chart");
    expect(mark.thread.messages[0].text).toBe("Use the September numbers");
    expect(reopened.slides[slideId].notes).toBe(CHART_NOTES);
    expect(reopened.slides[file.content.slideOrder[1]].notes).toBe(NEXT_NOTES);
  });

  it("survives save and reopen on the chart, not in the speaker notes", () => {
    const file = q3Update();
    const slideId = file.content.slideOrder[0];
    const added = addSlideComment(
      file.content,
      slideId,
      "chart",
      "Use the September numbers",
      "Maria",
      options,
    );
    file.content = replyToSlideComment(
      added.deck,
      slideId,
      added.threadId!,
      "Priya has them.",
      "Maria",
      options,
    );
    const saved = parseFile(serializeFile(file));
    expect(saved.kind).toBe("slide");
    if (saved.kind !== "slide") return;
    const slide = saved.content.slides[slideId];
    expect(slide.notes).toBe(CHART_NOTES);
    expect(slide.comments?.[0].elementId).toBe("chart");
    expect(slide.comments?.[0].messages.map((message) => message.text)).toEqual([
      "Use the September numbers",
      "Priya has them.",
    ]);
    expect(JSON.stringify(slide.notes)).not.toContain("Priya");
  });

  it("points a duplicated slide's comment at the copied object", () => {
    const file = q3Update() as SlideFile;
    const slideId = file.content.slideOrder[0];
    file.content = addSlideComment(
      file.content,
      slideId,
      "chart",
      "Use the September numbers",
      "Maria",
      options,
    ).deck;
    const copy = duplicateSlides(file.content, [slideId], () => crypto.randomUUID());
    const cloned = copy.deck.slides[copy.newIds[0]];
    expect(cloned.notes).toBe(CHART_NOTES);
    expect(cloned.comments).toHaveLength(1);
    expect(cloned.elements.some((element) => element.id === cloned.comments?.[0].elementId)).toBe(
      true,
    );
    expect(cloned.comments?.[0].elementId).not.toBe("chart");
    expect(copy.deck.slides[slideId].comments?.[0].elementId).toBe("chart");
  });
});

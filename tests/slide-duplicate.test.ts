import { expect, it } from "vitest";
import { duplicateSlide } from "../apps/web/src/collab/slide-duplicate";

const deck = {
  slideOrder: ["s1"],
  slides: {
    s1: {
      id: "s1",
      title: "Beds",
      notes: "Water the beds",
      elements: [
        { id: "a", text: "Beds" },
        { id: "b", text: "North" },
      ],
      comments: [{ id: "thread-1", text: "Water the beds" }],
    },
  },
};

it("copies a slide with new object ids and leaves the source", () => {
  const result = duplicateSlide(deck, "s1", "s2");
  expect(result.message).toBeNull();
  expect(result.deck.slideOrder).toEqual(["s1", "s2"]);
  const source = result.deck.slides.s1 as { elements: { id: string }[] };
  const copy = result.deck.slides.s2 as {
    id: string;
    notes: string;
    elements: { id: string; text: string }[];
    comments: { id: string }[];
  };
  expect(source.elements.map((element) => element.id)).toEqual(["a", "b"]);
  expect(copy.id).toBe("s2");
  expect(copy.notes).toBe("Water the beds");
  expect(copy.elements.map((element) => element.text)).toEqual(["Beds", "North"]);
  expect(copy.elements.map((element) => element.id)).toEqual(["copy-a", "copy-b"]);
  expect(copy.comments[0].id).toBe("copy-thread-1");
  expect(deck.slides.s1.elements[0].id).toBe("a");
  const again = duplicateSlide(result.deck, "s1", "s2");
  expect(again.message).toBe("That slide is already in the deck.");
  expect(again.deck.slideOrder).toEqual(["s1", "s2"]);
  const unnamed = duplicateSlide(deck, "s1", "secret-\nvalue");
  expect(unnamed.message).toBe("Name a new slide.");
  expect(unnamed.message).not.toContain("secret-value");
  expect(unnamed.deck).toBe(deck);
  const missing = duplicateSlide(deck, "s9", "s3");
  expect(missing.message).toBe("That slide is not in the deck.");
  expect(missing.deck).toBe(deck);
});

it("does not reuse an object id that is already in the deck", () => {
  const crowded = {
    slideOrder: ["s1"],
    slides: {
      s1: {
        id: "s1",
        elements: [{ id: "a", text: "Beds" }, { id: "copy-a", text: "Taken" }],
      },
    },
  };
  const result = duplicateSlide(crowded, "s1", "s2");
  const copy = result.deck.slides.s2 as { elements: { id: string; text: string }[] };
  expect(copy.elements.map((element) => element.id)).toEqual(["copy-a-2", "copy-copy-a"]);
  expect(result.deck.slides.s1).toBe(crowded.slides.s1);
  const taken: { id?: string; text: string }[] = [{ text: "skip" }, { id: "a", text: "Beds" }, { id: "copy-a", text: "Taken" }];
  for (let n = 2; n <= 100; n += 1) taken.push({ id: `copy-a-${n}`, text: "x" });
  const full = duplicateSlide(
    { slideOrder: [], slides: { s1: { id: "s1", elements: taken, comments: [{ text: "skip" }, "nope"] } } },
    "s1",
    "s2",
  );
  const copied = full.deck.slides.s2 as { elements: { text?: string }[]; comments: unknown[] };
  expect(copied.elements.some((element) => element.text === "Beds")).toBe(false);
  expect(copied.comments).toEqual([]);
  expect(full.deck.slideOrder).toEqual(["s2"]);
  expect(duplicateSlide(deck, "s1", "s1").message).toBe("Name a new slide.");
});

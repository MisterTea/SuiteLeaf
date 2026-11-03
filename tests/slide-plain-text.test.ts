import { expect, it } from "vitest";
import { slidePlainText } from "../apps/web/src/editors/slide-plain-text";

it("leaves a hidden slide out of the plain text", () => {
  const hidden = {
    title: "secret-value",
    hidden: true,
    notes: "secret-value",
    elements: [{ type: "text", content: "secret-value" }],
  };
  const shown = {
    title: "North",
    notes: "Water the beds",
    elements: [{ type: "text", content: "Beds" }],
  };
  const deck = { hidden, shown };
  const text = slidePlainText("Garden club", ["hidden", "shown"], deck);
  expect(text).toContain("Slides: 1");
  expect(text).toContain("--- Slide 1: North ---");
  expect(text).toContain("Beds");
  expect(text).toContain("[Speaker notes: Water the beds]");
  expect(text).not.toContain("secret-value");
  expect(hidden.notes).toBe("secret-value");
});

it("leaves a decorative object out of the plain text", () => {
  const shown = {
    title: "North",
    elements: [
      { type: "text", content: "Beds" },
      { type: "text", decorative: true, content: "secret-value" },
    ],
  };
  const text = slidePlainText("Garden club", ["shown"], { shown });
  expect(text).toContain("--- Slide 1: North ---");
  expect(text).toContain("Beds");
  expect(text).not.toContain("secret-value");
  expect(shown.elements[1].content).toBe("secret-value");
});

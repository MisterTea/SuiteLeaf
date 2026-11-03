import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  paragraphTexts,
  paragraphsAsDocument,
  roomAlreadyHasText,
  syncParagraphTexts,
} from "../packages/core/src";

describe("a second local file", () => {
  it("does not replace text the room already has", () => {
    const first = new Y.Doc();
    syncParagraphTexts(first, ["Tomatoes are in", "Beans are staked"]);
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const local = ["Tomatoes are in", "secret-value"];
    expect(roomAlreadyHasText(second)).toBe(true);
    if (!roomAlreadyHasText(second)) syncParagraphTexts(second, local);
    expect(paragraphTexts(second)).toEqual(["Tomatoes are in", "Beans are staked"]);
    expect(JSON.stringify(paragraphTexts(second))).not.toContain("secret-value");
    const shown = paragraphsAsDocument(paragraphTexts(second));
    expect(shown.content.map((block) => block.content?.[0]?.text)).toEqual([
      "Tomatoes are in",
      "Beans are staked",
    ]);
    expect(JSON.stringify(shown)).not.toContain("secret-value");
  });

  it("writes the local file into an empty room", () => {
    const doc = new Y.Doc();
    expect(roomAlreadyHasText(doc)).toBe(false);
    const local = ["Tomatoes are in"];
    if (!roomAlreadyHasText(doc)) syncParagraphTexts(doc, local);
    expect(paragraphTexts(doc)).toEqual(["Tomatoes are in"]);
    const fragment = new Y.Doc();
    fragment.getXmlFragment("prosemirror").insert(0, [new Y.XmlElement("paragraph")]);
    expect(roomAlreadyHasText(fragment)).toBe(true);
  });
});

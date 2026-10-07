import { expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { documentMatches } from "../apps/web/src/editors/doc-search-plugin";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    image: { inline: true, group: "inline", atom: true },
  },
  marks: { bold: {} },
});
it("finds text across formatting marks at editor positions, without crossing inline images", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("ced"),
      schema.text("ar", [schema.mark("bold")]),
    ]),
    schema.node("paragraph", null, [
      schema.text("ced"),
      schema.node("image"),
      schema.text("ar"),
    ]),
  ]);
  expect(
    documentMatches(doc, "cedar", {
      matchCase: false,
      regex: false,
      ignoreDiacritics: true,
    }).matches,
  ).toEqual([{ from: 1, to: 6 }]);
  expect(
    documentMatches(doc, "ar", {
      matchCase: false,
      regex: false,
      ignoreDiacritics: true,
    }).matches,
  ).toEqual([
    { from: 4, to: 6 },
    { from: 12, to: 14 },
  ]);
});

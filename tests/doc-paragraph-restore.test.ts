import { describe, expect, it } from "vitest";
import {
  applyParagraphRestore,
  compareParagraphs,
  diffDocuments,
  paragraphRestorePrompt,
  type JsonNode,
} from "@suiteleaf/core";

function text(value: string, marks?: { type: string }[]): JsonNode {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function paragraph(value: string, marks?: { type: string }[]): JsonNode {
  return { type: "paragraph", content: [text(value, marks)] };
}

const heading: JsonNode = {
  type: "heading",
  attrs: { level: 1 },
  content: [text("Watering rota")],
};

const monday: JsonNode = {
  type: "doc",
  content: [heading, paragraph("North bed: 6am"), paragraph("South bed: 7am")],
};

const tuesday: JsonNode = {
  type: "doc",
  content: [
    heading,
    paragraph("North bed: 8am"),
    paragraph("South bed: 7am", [{ type: "bold" }]),
    paragraph("Thursday: ask Alex to cover."),
  ],
};

describe("restore one paragraph", () => {
  it("offers restore only on blocks that differ from the current document", () => {
    const compared = compareParagraphs(monday, tuesday);
    expect(compared.offers).toHaveLength(diffDocuments(monday, tuesday).content.content?.length);
    expect(compared.changedParagraphs).toBe(2);
    const offered = compared.offers.filter((offer) => offer !== null);
    expect(offered.map((offer) => offer?.label)).toEqual(["north-bed", "thursday"]);
    expect(compared.offers[0]).toBeNull();
    expect(compared.offers[2]).toBeNull();
    expect(offered[0]?.becomes).toBe("North bed: 6am");
    expect(offered[0]?.action).toBe("replace");
    expect(offered[1]?.action).toBe("remove");
    expect(
      paragraphRestorePrompt(offered[0]!, '"Agreed rota"'),
    ).toBe(
      'Restore the north-bed paragraph from "Agreed rota"? It becomes "North bed: 6am". The rest of the document stays as it is.',
    );
    expect(paragraphRestorePrompt(offered[1]!, '"Agreed rota"')).toBe(
      'Restore the thursday paragraph from "Agreed rota"? It is removed. The rest of the document stays as it is.',
    );
  });

  it("puts Monday's north bed back and keeps the current bold and the Thursday line", () => {
    const offer = compareParagraphs(monday, tuesday).offers.find(
      (item) => item?.label === "north-bed",
    );
    const next = applyParagraphRestore(tuesday, monday, offer!.key);
    expect(next.content?.[0]).toEqual(tuesday.content?.[0]);
    expect(next.content?.[1]).toEqual(monday.content?.[1]);
    expect(next.content?.[2]).toEqual(tuesday.content?.[2]);
    expect(next.content?.[2]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
    expect(next.content?.[3]).toEqual(tuesday.content?.[3]);
    expect(JSON.stringify(next)).toContain("North bed: 6am");
    expect(JSON.stringify(next)).not.toContain("North bed: 8am");
  });

  it("can remove only the paragraph that was added later", () => {
    const offer = compareParagraphs(monday, tuesday).offers.find(
      (item) => item?.action === "remove",
    );
    const next = applyParagraphRestore(tuesday, monday, offer!.key);
    expect(next.content).toHaveLength(3);
    expect(next.content?.[1]).toEqual(tuesday.content?.[1]);
    expect(next.content?.[2]).toEqual(tuesday.content?.[2]);
    expect(JSON.stringify(next)).not.toContain("Thursday");
  });

  it("can put back a paragraph the current document deleted", () => {
    const current: JsonNode = {
      type: "doc",
      content: [paragraph("North bed: 6am")],
    };
    const earlier: JsonNode = {
      type: "doc",
      content: [paragraph("North bed: 6am"), paragraph("South bed: 7am")],
    };
    const offer = compareParagraphs(earlier, current).offers.find(
      (item) => item?.action === "insert",
    );
    expect(offer?.label).toBe("south-bed");
    const next = applyParagraphRestore(current, earlier, offer!.key);
    expect(next.content?.[0]).toEqual(current.content?.[0]);
    expect(next.content?.[1]).toEqual(earlier.content?.[1]);
  });

  it("offers nothing when the documents match", () => {
    const compared = compareParagraphs(monday, monday);
    expect(compared.offers.every((offer) => offer === null)).toBe(true);
    expect(compared.changedParagraphs).toBe(0);
  });
});

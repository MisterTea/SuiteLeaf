// @vitest-environment jsdom
import { generateHTML, generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { SectionBreak } from "../apps/web/src/editors/doc-section-break";

describe("section break HTML", () => {
  it("keeps the header, footer, and restart through a paste", () => {
    const extensions = [StarterKit, SectionBreak];
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        {
          type: "sectionBreak",
          attrs: { header: "Appendix", footer: "Notes", restartAt: 4 },
        },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    };
    const html = generateHTML(doc, extensions);
    expect(html).toContain('data-header="Appendix"');
    expect(html).toContain('data-footer="Notes"');
    expect(html).toContain('data-restart-at="4"');
    const back = generateJSON(html, extensions);
    const section = back.content?.find((node) => node.type === "sectionBreak");
    expect(section?.attrs).toMatchObject({
      header: "Appendix",
      footer: "Notes",
      restartAt: 4,
    });
  });
});

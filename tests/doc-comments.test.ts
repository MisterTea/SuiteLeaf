import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, parseFile, serializeFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import {
  commentAnchorText,
  commentImportSummary,
  commentThreads,
  importWordComments,
} from "../packages/core/src/doc-comments";
import { documentText } from "../packages/core/src/word";

function report() {
  const file = createFile("doc", "Quarterly Report");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    attrs: {
      commentThreads: [
        {
          id: "growth",
          quote: "grew 12%",
          resolved: false,
          messages: [
            {
              id: "m1",
              authorId: "local-jordan",
              authorName: "Jordan",
              createdAt: "2026-10-12T18:00:00.000Z",
              text: "Is 12% right? Finance says 11.5%.",
            },
          ],
        },
        {
          id: "heading",
          quote: "Outlook",
          resolved: true,
          resolvedBy: "Jordan",
          resolvedAt: "2026-10-12T19:00:00.000Z",
          messages: [
            {
              id: "m2",
              authorId: "local-jordan",
              authorName: "Jordan",
              createdAt: "2026-10-12T18:05:00.000Z",
              text: "Can we shorten this?",
            },
          ],
        },
      ],
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Quarterly Report" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Revenue " },
          {
            type: "text",
            text: "grew 12%",
            marks: [
              { type: "comment", attrs: { threadId: "growth", resolved: false } },
            ],
          },
          { type: "text", text: " in the quarter." },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          {
            type: "text",
            text: "Outlook",
            marks: [
              { type: "comment", attrs: { threadId: "heading", resolved: true } },
            ],
          },
        ],
      },
    ],
  };
  return file;
}

describe("document comment threads", () => {
  it("writes Word comments on the same text, including a resolved thread with no reply", async () => {
    const file = report();
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const comments = await zip.file("word/comments.xml")!.async("string");
    const doc = await zip.file("word/document.xml")!.async("string");
    const extended = await zip.file("word/commentsExtended.xml")!.async("string");
    expect(comments).toContain('w:author="Jordan"');
    expect(comments).toContain("Is 12% right? Finance says 11.5%.");
    expect(comments).toContain("Can we shorten this?");
    expect(comments).not.toContain("Owner");
    const anchors = commentAnchorText(doc);
    expect([...anchors.values()]).toContain("grew 12%");
    expect([...anchors.values()]).toContain("Outlook");
    expect(doc).toMatch(/<w:r>\s*<w:commentReference\b/);
    expect(extended).toContain('w15:done="1"');
    const saved = parseFile(serializeFile(file));
    expect(commentThreads(saved.content)).toHaveLength(2);
  });

  it("imports Word replies and done state onto the same words and counts the threads", async () => {
    const file = report();
    if (file.kind !== "doc") throw new Error();
    const threads = commentThreads(file.content);
    threads[0].messages.push({
      id: "m3",
      authorId: "word:Alex",
      authorName: "Alex",
      createdAt: "2026-10-12T20:00:00.000Z",
      text: "Yes, 11.5% — fixed",
    });
    file.content.attrs = { ...file.content.attrs, commentThreads: threads };
    const growth = file.content.content?.[1];
    const marked = growth?.content?.[1];
    if (marked?.text) marked.text = "grew 11.5%";
    const bytes = await exportDocx(file);
    const zip = await JSZip.loadAsync(bytes);
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain("grew 11.5%");
    expect(await zip.file("word/comments.xml")!.async("string")).toContain(
      'w:author="Alex"',
    );
    const imported = await importOffice(bytes, "docx", "Quarterly Report.docx");
    if (imported.file.kind !== "doc") throw new Error();
    expect(imported.report.warnings).toContain(commentImportSummary(2));
    expect(imported.report.features).toContain("comments");
    const back = commentThreads(imported.file.content);
    expect(back).toHaveLength(2);
    const growthThread = back.find((thread) =>
      thread.messages.some((message) => message.authorName === "Alex"),
    );
    expect(growthThread?.messages.map((message) => message.authorName)).toEqual([
      "Jordan",
      "Alex",
    ]);
    expect(growthThread?.quote).toContain("11.5%");
    expect(growthThread?.orphaned).toBeFalsy();
    expect(documentText(imported.file.content)).toContain("grew 11.5%");
    const outlook = back.find((thread) =>
      thread.messages.some((message) => message.text.startsWith("Can we shorten")),
    );
    expect(outlook?.resolved).toBe(true);
    const markedText = JSON.stringify(imported.file.content);
    expect(markedText).toContain("grew 11.5%");
    expect(markedText).toContain('"type":"comment"');
  });

  it("keeps a thread when the anchor text cannot be found", () => {
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Still here." }] }],
    };
    const imported = importWordComments(content, {
      documentXml:
        '<w:commentRangeStart w:id="0"/><w:t>missing phrase</w:t><w:commentRangeEnd w:id="0"/>',
      commentsXml:
        '<w:comment w:id="0" w:author="Jordan" w:date="2026-10-12T18:00:00Z"><w:p w14:paraId="00000001"><w:r><w:t>Where did it go?</w:t></w:r></w:p></w:comment>',
      extendedXml: '<w15:commentEx w15:paraId="00000001" w15:done="0"/>',
    });
    expect(imported.count).toBe(1);
    const [thread] = commentThreads(imported.content);
    expect(thread.orphaned).toBe(true);
    expect(thread.quote).toBe("missing phrase");
    expect(thread.messages[0].authorName).toBe("Jordan");
    expect(thread.messages[0].text).toBe("Where did it go?");
  });
});

import { describe, expect, it } from "vitest";
import { fileCommentDirection } from "../apps/web/src/drive/file-comment-direction";

describe("file comment direction", () => {
  it("follows the file language and leaves a form left to right", () => {
    expect(fileCommentDirection({ kind: "sheet", content: { proofingLanguage: "ar" } })).toBe("rtl");
    expect(fileCommentDirection({ kind: "slide", content: { proofingLanguage: "he" } })).toBe("rtl");
    expect(fileCommentDirection({ kind: "doc", content: { attrs: { proofing: { language: "ar" } } } })).toBe("rtl");
    expect(fileCommentDirection({ kind: "doc", content: { attrs: { proofing: { language: "en" } } } })).toBe("ltr");
    expect(fileCommentDirection({ kind: "form", content: { proofingLanguage: "ar" } })).toBe("ltr");
    expect(fileCommentDirection({ kind: "sheet", content: null })).toBe("ltr");
    expect(fileCommentDirection({ kind: "sheet", content: { proofingLanguage: "secret-value" } })).toBe("ltr");
  });
});

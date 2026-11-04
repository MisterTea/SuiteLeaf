/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { commentExtensions, DocComments } from "../../apps/web/src/editors/doc-comments";
import { Proofing } from "../../apps/web/src/editors/doc-spelling";

function mount(language: string) {
  const editor = new Editor({
    extensions: [StarterKit, Proofing, ...commentExtensions],
    content: {
      type: "doc",
      attrs: { proofing: { language } },
      content: [{ type: "paragraph", content: [{ type: "text", text: "North" }] }],
    },
  });
  const view = render(
    <DocComments
      editor={editor}
      stageRef={{ current: null }}
      onGutter={() => {}}
      bind={() => {}}
    />,
  );
  return { editor, view };
}

describe("document comment direction", () => {
  it("writes Arabic comments from right to left", () => {
    const arabic = mount("ar");
    expect(arabic.view.container.querySelector(".doc-comment-gutter")?.getAttribute("dir")).toBe("rtl");
    arabic.editor.destroy();
    arabic.view.unmount();
    const english = mount("en");
    expect(english.view.container.querySelector(".doc-comment-gutter")?.getAttribute("dir")).toBe("ltr");
    expect(english.view.container.textContent).not.toContain("secret-value");
    english.editor.destroy();
  });
});

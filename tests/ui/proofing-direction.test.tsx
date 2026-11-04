/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useDocProofing, type ProofingContext } from "../../apps/web/src/editors/doc-proofing";
import { Proofing } from "../../apps/web/src/editors/doc-spelling";

function Harness({ language }: { language: string }) {
  const editor = useRef<Editor | null>(null);
  if (!editor.current) {
    editor.current = new Editor({
      extensions: [StarterKit, Proofing],
      content: {
        type: "doc",
        attrs: { proofing: { language } },
        content: [{ type: "paragraph", content: [{ type: "text", text: "North" }] }],
      },
    });
  }
  const context = useRef<ProofingContext>(() => false);
  const proofing = useDocProofing(editor.current, 1, context);
  return (
    <div>
      <button type="button" onClick={() => proofing.openDictionary()}>
        Dictionary
      </button>
      <button type="button" onClick={() => proofing.openWordCount()}>
        Count
      </button>
      {proofing.ui}
    </div>
  );
}

describe("proofing dialog direction", () => {
  it("writes the Arabic dictionary from right to left", () => {
    const view = render(<Harness language="ar" />);
    fireEvent.click(screen.getByRole("button", { name: "Dictionary" }));
    expect(document.querySelector(".dictionary-dialog")?.getAttribute("dir")).toBe("rtl");
    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(document.querySelector(".word-count-dialog")?.getAttribute("dir")).toBe("rtl");
    view.unmount();
    render(<Harness language="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Dictionary" }));
    expect(document.querySelector(".dictionary-dialog")?.getAttribute("dir")).toBe("ltr");
    expect(document.body.textContent).not.toContain("secret-value");
  });
});

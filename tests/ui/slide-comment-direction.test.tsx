/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Presentation } from "@suiteleaf/core";
import { useSlideComments } from "../../apps/web/src/editors/slide-comments-ui";

function Harness({ language }: { language: Presentation["proofingLanguage"] }) {
  const comments = useSlideComments({
    deck: {
      width: 960,
      height: 540,
      proofingLanguage: language,
      slides: {
        one: {
          id: "one",
          elements: [{ id: "title", type: "text", x: 40, y: 40, width: 200, height: 40, content: "North" }],
        },
      },
    } as Presentation,
    activeSlideId: "one",
    selectedElementId: "title",
    presenting: false,
    commit: () => {},
    onActivate: () => {},
  });
  return (
    <div>
      <button type="button" onClick={() => comments.openComposer()}>
        Open
      </button>
      {comments.dock}
    </div>
  );
}

describe("slide comment direction", () => {
  it("writes an Arabic comment from right to left", () => {
    const view = render(<Harness language="ar" />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(document.querySelector(".side-pane")?.getAttribute("dir")).toBe("rtl");
    view.unmount();
    render(<Harness language="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(document.querySelector(".side-pane")?.getAttribute("dir")).toBe("ltr");
    expect(document.body.textContent).toContain("North");
    expect(document.body.textContent).not.toContain("secret-value");
  });
});

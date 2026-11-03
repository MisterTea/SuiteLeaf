// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccessNotes } from "../../apps/web/src/editors/access-notes";
import type { JsonNode } from "@suiteleaf/core";

afterEach(cleanup);

const doc = (content: JsonNode[]): JsonNode => ({ type: "doc", content });

describe("accessibility notes", () => {
  it("marks an automatic heading skip separately from a note a person must judge", () => {
    render(
      <AccessNotes
        doc={doc([
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "North" }] },
          { type: "image", attrs: { alt: "", src: "data:image/png;base64,aa" } },
        ])}
      />,
    );
    expect(screen.getByRole("region", { name: "Accessibility notes" })).toBeTruthy();
    expect(screen.getByText(/Start with level 1/)).toBeTruthy();
    expect(screen.getAllByText("Automatic").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs a person")).toBeTruthy();
    expect(screen.getByText(/not a conformance claim/)).toBeTruthy();
    const selected: number[][] = [];
    cleanup();
    render(
      <AccessNotes
        doc={doc([
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "North" }] },
          { type: "image", attrs: { alt: "", src: "data:image/png;base64,aa" } },
        ])}
        onSelect={(path) => selected.push(path)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /North/ }));
    expect(selected).toEqual([[0]]);
  });

  it("says when the document has no notes", () => {
    render(
      <AccessNotes
        doc={doc([
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Beds" }] },
        ])}
      />,
    );
    expect(screen.getByText("No notes for this document.")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SlideAccessPanel, piecesForAccess } from "../../apps/web/src/editors/slide-access-notes";

afterEach(cleanup);

describe("slide accessibility notes", () => {
  it("names an image without alternative text and skips a video", () => {
    const mapped = piecesForAccess([
      { id: "title", type: "text" },
      { id: "photo", type: "image" },
      { id: "clip", type: "video" },
    ]);
    expect(mapped.skipped).toBe(0);
    expect(mapped.pieces.map((piece) => piece.id)).toEqual(["title", "photo", "clip"]);
    render(
      <SlideAccessPanel
        elements={[
          { id: "title", type: "text" },
          { id: "photo", type: "image" },
          { id: "clip", type: "video", src: "secret-value" },
        ]}
      />,
    );
    expect(screen.getByRole("region", { name: "Slide accessibility" })).toBeTruthy();
    expect(screen.getByText("This image needs alternative text.")).toBeTruthy();
    expect(screen.getByText("This video has no captions.")).toBeTruthy();
    expect(screen.getByText("This video needs alternative text.")).toBeTruthy();
    expect(screen.getByText(/Reading order: title, photo, clip/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Slide accessibility" }).textContent).not.toContain(
      "secret-value",
    );
    render(
      <SlideAccessPanel
        elements={[{ id: "title", type: "text" }]}
        title=""
        background="#ffffff"
        textColor="#ffff00"
      />,
    );
    expect(screen.getByText("This slide needs a title.")).toBeTruthy();
    expect(screen.getByText("The title color does not contrast with the slide background.")).toBeTruthy();
  });

  it("edits one slide object from its text field and leaves the other", () => {
    const edits: { pieces: { id: string; alt?: string }[]; texts: Record<string, string> }[] = [];
    render(
      <SlideAccessPanel
        elements={[
          { id: "title", type: "text" },
          { id: "photo", type: "image", alt: "North beds" },
        ]}
        texts={{ title: "Beds" }}
        onEdit={(pieces, texts) => edits.push({ pieces, texts })}
      />,
    );
    expect(screen.getByRole("textbox", { name: "text title" }).getAttribute("value")).toBe("Beds");
    expect(screen.getByRole("textbox", { name: "image photo" }).getAttribute("value")).toBe(
      "North beds",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "image photo" }), {
      target: { value: "South beds" },
    });
    expect(edits[0].pieces.find((piece) => piece.id === "photo")?.alt).toBe("South beds");
    expect(edits[0].texts.title).toBe("Beds");
    expect(edits[0].pieces.find((piece) => piece.id === "title")?.alt).toBeUndefined();
  });

  it("lists a stored reading order ahead of the element list", () => {
    render(
      <SlideAccessPanel
        elements={[
          { id: "title", type: "text" },
          { id: "photo", type: "image", alt: "North beds" },
        ]}
        order={["photo", "title"]}
      />,
    );
    expect(screen.getByText(/Reading order: photo, title/)).toBeTruthy();
  });

  it("moves the title later without dragging", () => {
    const orders: string[][] = [];
    render(
      <SlideAccessPanel
        elements={[
          { id: "title", type: "text" },
          { id: "photo", type: "image", alt: "North beds" },
        ]}
        texts={{ title: "Beds" }}
        onMove={(order) => orders.push(order)}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Move text 1 earlier" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move text 1 later" }));
    expect(orders).toEqual([["photo", "title"]]);
    expect(screen.getByRole("region", { name: "Slide accessibility" }).textContent).not.toContain(
      "secret-value",
    );
  });

  it("leaves a decorative image out of the reading order", () => {
    render(
      <SlideAccessPanel
        elements={[
          { id: "title", type: "text" },
          { id: "photo", type: "image", alt: "secret-value", decorative: true },
        ]}
      />,
    );
    const region = screen.getByRole("region", { name: "Slide accessibility" });
    expect(region.textContent).toContain("Reading order: title");
    expect(region.textContent).not.toContain("photo");
    expect(region.textContent).not.toContain("secret-value");
    expect(region.textContent).not.toContain("This image needs alternative text.");
    cleanup();
    const marked: boolean[] = [];
    render(
      <SlideAccessPanel
        elements={[{ id: "photo", type: "image", alt: "secret-value" }]}
        onEdit={(next) => marked.push(Boolean(next.find((piece) => piece.id === "photo")?.decorative))}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Decorative image photo" }));
    expect(marked).toEqual([true]);
    expect(screen.getByRole("region", { name: "Slide accessibility" }).textContent).not.toContain(
      "secret-value",
    );
  });

  it("names a picture on a video without repeating its address", () => {
    render(
      <SlideAccessPanel
        elements={[
          {
            id: "clip",
            type: "video",
            alt: "Beds",
            caption: "North beds",
            poster: "secret-value",
            src: "secret-value",
          },
        ]}
      />,
    );
    expect(screen.getByText("This video's picture is not an embedded image.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Slide accessibility" }).textContent).not.toContain(
      "secret-value",
    );
  });

  it("shows a table's cells and refuses a different number of columns", () => {
    const rows = [
      ["Plot", "North"],
      ["Beds", "10"],
    ];
    const edits: string[][][] = [];
    render(
      <SlideAccessPanel
        elements={[{ id: "grid", type: "table" }]}
        tables={{ grid: rows }}
        onEdit={(_pieces, texts) => {
          const parsed = texts.grid?.split("\n").map((line) => line.split("\t")) ?? [];
          edits.push(parsed);
        }}
      />,
    );
    const field = screen.getByRole("textbox", { name: "table grid" });
    expect((field as HTMLInputElement).value).toBe("Plot\tNorth\nBeds\t10");
    fireEvent.change(field, { target: { value: "Plot\nsecret-value" } });
    const note = screen.getByText("Keep the same number of columns.");
    expect(note.textContent).not.toContain("secret-value");
    expect(edits).toEqual([]);
    fireEvent.change(field, { target: { value: "Plot\tSouth\nBeds\t10" } });
    expect(edits).toEqual([[["Plot", "South"], ["Beds", "10"]]]);
    expect(rows[0]).toEqual(["Plot", "North"]);
  });
});

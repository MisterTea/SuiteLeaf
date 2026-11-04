// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { documentPageSettings, type PageSettings } from "../../packages/core/src/document-layout";
import { PageFurniture, PageSetupFields } from "../../apps/web/src/editors/page-setup";

afterEach(cleanup);

const settings = (initial: Partial<PageSettings> = {}) =>
  documentPageSettings({ type: "doc", attrs: { pageSettings: initial } });

function Fields({ initial, pageCount = 3, seen }: { initial: Partial<PageSettings>; pageCount?: number; seen?: (draft: PageSettings) => void }) {
  const [draft, setDraft] = useState(() => settings(initial));
  seen?.(draft);
  return <PageSetupFields draft={draft} pageCount={pageCount} onChange={setDraft} />;
}

function open(initial: Partial<PageSettings> = {}, pageCount = 3) {
  let latest = settings(initial);
  render(<Fields initial={initial} pageCount={pageCount} seen={(draft) => (latest = draft)} />);
  return () => latest;
}

const preview = () => screen.getByRole("group", { name: "Page preview" });
const labels = () => [...preview().querySelectorAll(".page-setup-preview-label")].map((node) => node.textContent);

describe("page numbers in page setup", () => {
  it("switches the number format and position", () => {
    const draft = open({ pageNumbers: true });
    const format = screen.getByRole("group", { name: "Format" });
    const [fraction, page, roman] = within(format).getAllByRole("radio");
    fireEvent.click(roman);
    expect(draft().pageNumberFormat).toBe("roman");
    fireEvent.click(fraction);
    expect(draft().pageNumberFormat).toBe("fraction");
    fireEvent.click(page);
    expect(draft().pageNumberFormat).toBe("page");
    fireEvent.click(screen.getByRole("radio", { name: "Bottom center" }));
    expect(draft()).toMatchObject({ pageNumberPosition: "bottom-center", pageNumberPositionSet: true });
    expect(preview().textContent).toContain("in the center");
    fireEvent.click(screen.getByRole("radio", { name: "Top right" }));
    expect(preview().textContent).toContain("at the top right");
  });

  it("refuses a start before page 1 and says where numbering stays", () => {
    const draft = open({ pageNumbers: true });
    const start = screen.getByLabelText("Start at");
    fireEvent.change(start, { target: { value: "0" } });
    expect(start.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/^Numbering starts at 1 or later\. The page stays on /);
    expect(draft().pageNumberStart).toBe(1);
    fireEvent.change(start, { target: { value: "5" } });
    expect(draft().pageNumberStart).toBe(5);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(labels()[0]).toMatch(/^File page 1/);
  });

  it("turns page numbers off and on", () => {
    const draft = open({ pageNumbers: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Page numbers" }));
    expect(draft().pageNumbers).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Cover has no number" })).toHaveProperty("disabled", true);
  });

  it("describes odd and even numbering on the outside edge", () => {
    open({ pageNumbers: true, pageNumberPosition: "bottom-center", pageNumberPositionSet: true, differentOddEven: true });
    expect(screen.getByText("The number sits on the outside edge. Untick to put it back at the bottom center.")).toBeTruthy();
    cleanup();
    open({ pageNumbers: true, pageNumberPosition: "bottom-right", pageNumberPositionSet: true, differentOddEven: true });
    expect(screen.getByText(/back at the bottom right\./)).toBeTruthy();
    expect(preview().textContent).toMatch(/on the left/);
  });
});

describe("headers and footers in page setup", () => {
  it("edits one header and footer for every page, and toggles odd and even pages", () => {
    const draft = open();
    expect(screen.getByText("Even and odd pages after the first can each have a header and a footer.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Page header"), { target: { value: "Minutes" } });
    fireEvent.change(screen.getByLabelText("Page footer"), { target: { value: "Draft" } });
    expect(draft()).toMatchObject({ header: "Minutes", footer: "Draft" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Different odd and even pages" }));
    expect(draft().differentOddEven).toBe(true);
    expect(screen.getByText("Untick to put “Minutes” back on every later page.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Even page header"), { target: { value: "Left" } });
    fireEvent.change(screen.getByLabelText("Even page footer"), { target: { value: "L foot" } });
    fireEvent.change(screen.getByLabelText("Odd page header"), { target: { value: "Right" } });
    fireEvent.change(screen.getByLabelText("Odd page footer"), { target: { value: "R foot" } });
    expect(draft()).toMatchObject({ evenHeader: "Left", evenFooter: "L foot", oddHeader: "Right", oddFooter: "R foot" });
    expect(screen.getByText("Pages 1, 3, 5… Title and number on the right.")).toBeTruthy();
  });

  it("gives the first page its own header and footer", () => {
    const draft = open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Different first page" }));
    expect(draft().differentFirstPage).toBe(true);
    fireEvent.change(screen.getByLabelText("First page header"), { target: { value: "Letterhead" } });
    fireEvent.change(screen.getByLabelText("First page footer"), { target: { value: "Address" } });
    expect(draft()).toMatchObject({ firstHeader: "Letterhead", firstFooter: "Address" });
    expect(screen.getByLabelText("Header for later pages")).toBeTruthy();
    expect(screen.getByLabelText("Footer for later pages")).toBeTruthy();
    expect(screen.getByText("One header and footer, with the number on the right.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Different odd and even pages" }));
    expect(screen.getByText("Pages 3, 5, 7… Title and number on the right.")).toBeTruthy();
  });

  it("explains odd and even pages after a cover without a number", () => {
    open({ pageNumbers: true, differentOddEven: true, coverHasNoNumber: true });
    expect(screen.getByText("Page 2, then 4, 6… The number stays on the left.")).toBeTruthy();
    expect(screen.getByText("Page 1 is the page after the cover. The number stays on the right.")).toBeTruthy();
  });

  it("adds a header picture from a file and removes it", async () => {
    const draft = open();
    const input = screen.getByLabelText("Header image");
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    fireEvent.change(input, { target: { files: [new File([png], "logo.png", { type: "image/png" })] } });
    await waitFor(() => expect(draft().headerImage).toMatch(/^data:image\/png;base64,/));
    expect(document.querySelector(".furniture-image-field img")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(draft().headerImage).toBe("");
  });

  it("ignores a picture over a megabyte or no file at all", async () => {
    const draft = open();
    const input = screen.getByLabelText("Footer image");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(1024 * 1024 + 1)], "big.png", { type: "image/png" })] } });
    fireEvent.change(input, { target: { files: [] } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(draft().footerImage).toBe("");
  });

  it("sets a watermark", () => {
    const draft = open();
    fireEvent.change(screen.getByLabelText("Watermark"), { target: { value: "DRAFT" } });
    expect(draft().watermark).toBe("DRAFT");
  });
});

describe("the page preview", () => {
  it("shows the first and last page of a long document and skips the middle", () => {
    open({ pageNumbers: true }, 9);
    expect(preview().className).toContain("is-ends");
    expect(preview().querySelector(".page-setup-preview-skip-label")?.textContent).not.toBe("");
    expect(labels()).toEqual(["Page 1 · first", "Page 9 · last"]);
  });

  it("shows the last even and last odd page when they differ", () => {
    open({ pageNumbers: true, differentOddEven: true }, 9);
    expect(preview().className).toContain("is-parity");
    expect(labels()).toEqual(["Page 8 · last even", "Page 9 · last odd"]);
  });

  it("labels each page of a short document", () => {
    open({}, 3);
    expect(labels()).toEqual(["Page 1", "Page 2 · even", "Page 3 · odd"]);
  });
});

describe("page furniture on the paper", () => {
  it("draws headers, footers, and numbers on each side", () => {
    const sides = (draft: PageSettings, count: number) => {
      const { container, unmount } = render(<PageFurniture settings={draft} pageCount={count} />);
      const pages = [...container.querySelectorAll<HTMLElement>(".page-furniture-page")].map((page) => ({
        side: page.dataset.numberSide,
        number: page.querySelector(".page-number")?.textContent ?? "",
        header: page.querySelector(".page-header")?.textContent,
        footer: page.querySelector(".page-footer-text")?.textContent,
      }));
      unmount();
      return pages;
    };
    expect(sides(settings({ pageNumbers: true, header: "Minutes", footer: "Club" }), 2)).toEqual([
      { side: "right", number: "1 / 2", header: "Minutes", footer: "Club" },
      { side: "right", number: "2 / 2", header: "Minutes", footer: "Club" },
    ]);
    expect(sides(settings({ pageNumbers: true, pageNumberPosition: "top-right", pageNumberPositionSet: true }), 1)[0]).toMatchObject({ side: "top-right", number: "1 / 1" });
    expect(sides(settings({ pageNumbers: true, differentOddEven: true }), 2).map((page) => page.side)).toEqual(["right", "left"]);
    expect(sides(settings({ pageNumbers: true, pageNumberPosition: "bottom-center", pageNumberPositionSet: true }), 1)[0].side).toBe("center");
  });
});

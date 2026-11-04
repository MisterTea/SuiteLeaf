// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { documentPageSettings, pageSideInsets, type PageSettings } from "../../packages/core/src/document-layout";
import { PageSetupFit } from "../../apps/web/src/editors/page-setup-fit";
import { HeaderEdgeFields } from "../../apps/web/src/editors/header-edge";
import { GutterField, PageGutterBands } from "../../apps/web/src/editors/page-gutter";
import { PageMarginFields as InchMarginFields } from "../../apps/web/src/editors/page-margins";
import { PageMarginFields as BandMarginFields } from "../../apps/web/src/editors/page-setup-margins";
import { liveMargins, publishLiveMargins, readLiveMargins } from "../../apps/web/src/editors/margin-live";

afterEach(cleanup);

const inch = (n: number) => n * 96;
const settings = (patch: Partial<PageSettings> = {}) =>
  documentPageSettings({ type: "doc", attrs: { pageSettings: { margin: inch(1), ...patch } } });

function harness(Fields: (props: { draft: PageSettings; onChange: (next: PageSettings) => void }) => React.ReactElement, initial = settings()) {
  let latest = initial;
  function Host() {
    const [draft, setDraft] = useState(initial);
    latest = draft;
    return <Fields draft={draft} onChange={setDraft} />;
  }
  render(<Host />);
  return () => latest;
}

describe("margins and edge distances in page setup", () => {
  it("moves one margin at a time and names the edge that moves", () => {
    const draft = harness(PageSetupFit);
    const left = screen.getByLabelText("Left margin");
    expect(screen.getByText("The blue band is the margin. The white box is where the text sits.")).toBeTruthy();
    fireEvent.focus(left);
    expect(screen.getByText("Left is the edge that will move. The others stay as they are.")).toBeTruthy();
    fireEvent.change(left, { target: { value: "1." } });
    expect(left).toHaveProperty("value", "1.");
    fireEvent.change(left, { target: { value: "1.5" } });
    expect(draft().marginLeft).toBe(inch(1.5));
    fireEvent.change(left, { target: { value: "1.5x" } });
    expect(left).toHaveProperty("value", "1.5");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("left 1.5 in");
    fireEvent.blur(left);
    expect(screen.getByText(/The blue band is the margin/)).toBeTruthy();
  });

  it("refuses an empty or out-of-range margin", () => {
    const draft = harness(PageSetupFit);
    const top = screen.getByLabelText("Top margin");
    fireEvent.change(top, { target: { value: "" } });
    expect(Number.isNaN(draft().marginTop)).toBe(true);
    expect(top.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Enter a margin in inches.");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Top – in");
    fireEvent.change(top, { target: { value: "4" } });
    expect(screen.getByRole("alert").textContent).toBe("A margin cannot be more than 3 inches.");
  });

  it("checks the header and footer distances on their own", () => {
    const draft = harness(HeaderEdgeFields);
    const header = screen.getByLabelText("Header from edge");
    fireEvent.change(header, { target: { value: "0.75" } });
    expect(draft().headerFromEdge).toBe(inch(0.75));
    fireEvent.change(header, { target: { value: "0.7a" } });
    expect(header).toHaveProperty("value", "0.75");
    fireEvent.change(header, { target: { value: "" } });
    expect(Number.isNaN(draft().headerFromEdge)).toBe(true);
    expect(header.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").id).toBe("header-edge-note");
    fireEvent.change(screen.getByLabelText("Footer from edge"), { target: { value: "2.5" } });
    const footerNote = document.getElementById("footer-edge-note");
    expect(footerNote?.textContent).not.toBe("");
  });

  it("asks for a gutter from 0 to 2 inches and draws both sides of the sheet", () => {
    let px = 0;
    const { rerender } = render(<GutterField px={0} onPx={(next) => (px = next)} />);
    expect(screen.getByText("No extra room yet. Both pages use the same margins.")).toBeTruthy();
    const field = screen.getByLabelText("Gutter (inches)");
    fireEvent.change(field, { target: { value: "0.5" } });
    expect(px).toBe(inch(0.5));
    expect(screen.getByText(/Odd pages on the left/)).toBeTruthy();
    expect(screen.getAllByRole("figure").map((figure) => figure.textContent)).toEqual(["2Even page", "3Odd page"]);
    fireEvent.change(field, { target: { value: "3" } });
    expect(screen.getByText(/larger than 2 inches is refused/)).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryAllByRole("figure")).toHaveLength(0);
    fireEvent.change(field, { target: { value: "" } });
    expect(Number.isNaN(px)).toBe(true);
    expect(screen.getByText("Enter a gutter from 0 to 2 inches.")).toBeTruthy();
    rerender(<GutterField px={Number.NaN} onPx={() => {}} />);
    cleanup();
    render(<GutterField px={Number.NaN} onPx={() => {}} />);
    expect(screen.getByLabelText("Gutter (inches)")).toHaveProperty("value", "");
  });

  it("shades the binding edge on each page, left on odd pages and right on even", () => {
    const { container, rerender } = render(<PageGutterBands settings={settings({ gutter: inch(0.5) })} pageCount={2} />);
    const bands = [...container.querySelectorAll<HTMLElement>(".page-gutter-band")];
    expect(bands.map((band) => [band.style.left, band.style.right])).toEqual([
      ["96px", ""],
      ["", "96px"],
    ]);
    rerender(<PageGutterBands settings={settings()} pageCount={2} />);
    expect(container.querySelector(".page-gutter-band")).toBeNull();
  });
});

describe("the margin fields with a preview of the edge", () => {
  it("shows each edge in inches, highlights the one being typed, and refuses bad values", () => {
    const draft = harness(InchMarginFields);
    expect(screen.getByRole("status").textContent).toBe("Only the top margin changes.");
    const right = screen.getByLabelText("Right margin");
    fireEvent.focus(right);
    expect(screen.getByRole("status").textContent).toBe("Only the right margin changes.");
    fireEvent.change(right, { target: { value: "2" } });
    expect(draft()).toMatchObject({ right: inch(2), marginRight: inch(2) });
    expect(document.querySelector(".margin-preview-original")).not.toBeNull();
    fireEvent.change(right, { target: { value: "2b" } });
    expect(right).toHaveProperty("value", "2");
    fireEvent.change(right, { target: { value: "." } });
    expect(screen.getByRole("alert").textContent).toBe("Enter each margin in inches.");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("right . in");
    fireEvent.change(right, { target: { value: "" } });
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("right — in");
    fireEvent.focus(screen.getByLabelText("Top margin"));
    expect(screen.getByRole("alert").textContent).toBe("Enter each margin in inches.");
    fireEvent.change(screen.getByLabelText("Top margin"), { target: { value: "0.1" } });
    expect(screen.getByRole("alert").textContent).toBe("A margin must be at least 0.25 inches.");
  });

  it("shows the margins as bands on a small page", () => {
    const draft = harness(BandMarginFields);
    expect(screen.getByText("The blue band is the margin. The white box is where the text sits.")).toBeTruthy();
    const bottom = screen.getByLabelText("Bottom margin");
    fireEvent.focus(bottom);
    expect(screen.getByText("Bottom is the edge that will move. The others stay as they are.")).toBeTruthy();
    expect(document.querySelector(".margin-preview-page")!.className).toContain("edge-marginBottom");
    fireEvent.change(bottom, { target: { value: "0.5" } });
    expect(draft().marginBottom).toBe(inch(0.5));
    expect((document.querySelector(".margin-preview-page") as HTMLElement).style.paddingBottom).toBe("8px");
    fireEvent.change(bottom, { target: { value: "5" } });
    expect(screen.getByRole("alert").textContent).toBe("A margin cannot be more than 3 inches.");
    fireEvent.blur(bottom);
    expect(document.querySelector(".margin-preview-page")!.className).not.toContain("edge-");
  });
});

describe("margins drawn while page setup is open", () => {
  it("moves the side insets and gutter band with the margin being typed", () => {
    const saved = settings({ gutter: inch(0.5) });
    const shown = liveMargins(saved, { ...saved, marginLeft: inch(2), marginTop: Number.NaN });
    expect(shown.marginLeft).toBe(inch(2));
    expect(shown.left).toBe(inch(2));
    expect(shown.marginTop).toBe(saved.marginTop);
    expect(pageSideInsets(shown, 1).left).toBe(inch(2.5));
    expect(liveMargins(saved, saved)).toBe(saved);
  });

  it("publishes the open dialog's margins on the page and reads them back", () => {
    const root = document.createElement("div");
    let events = 0;
    root.addEventListener("suiteleaf-letterhead-live", () => events++);
    publishLiveMargins(root, settings({ marginTop: inch(1.5) }));
    expect(readLiveMargins(root)).toEqual({ marginTop: inch(1.5), marginRight: inch(1), marginBottom: inch(1), marginLeft: inch(1) });
    publishLiveMargins(root, settings({ marginTop: inch(1.5) }));
    expect(events).toBe(1);
    publishLiveMargins(root, null);
    expect(events).toBe(2);
    expect(readLiveMargins(root)).toBeNull();
    root.dataset.marginLive = "1,2,x,4";
    expect(readLiveMargins(root)).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmbeddedDrawing from "../../apps/web/src/editors/drawing-embed";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="4"/></svg>';

afterEach(cleanup);

function open(readOnly = false) {
  const onClose = vi.fn();
  render(<EmbeddedDrawing svg={SVG} parentTitle="Q3 plan" readOnly={readOnly} onClose={onClose} />);
  return { onClose, back: screen.getByRole("button", { name: "Back to Q3 plan" }), source: screen.getByLabelText("SVG source") };
}

describe("Drawing opened on a picture in another file", () => {
  it("covers the file with the picture's SVG and a way back", () => {
    const { source } = open();
    expect(screen.getByRole("dialog", { name: "Picture in Q3 plan" })).toBeTruthy();
    expect(source).toHaveProperty("value", SVG);
  });

  it("says nothing changed when the picture was left alone", async () => {
    const { back, onClose } = open();
    fireEvent.click(back);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(null));
  });

  it("hands back the new SVG, including typing that had not paused yet, only on the way back", async () => {
    const { back, source, onClose } = open();
    const next = SVG.replace('width="4"', 'width="6"');
    fireEvent.change(source, { target: { value: next } });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(back);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(next));
  });

  it("says where the changes will go once there are some", async () => {
    const { source } = open();
    fireEvent.change(source, { target: { value: SVG.replace('width="4"', 'width="6"') } });
    fireEvent.blur(source);
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Your changes go into “Q3 plan” when you go back."),
    );
  });

  it("will not put broken SVG back into the file, but lets the person leave without it", async () => {
    const { back, source, onClose } = open();
    fireEvent.change(source, { target: { value: "<svg><rect></svg>" } });
    fireEvent.click(back);
    const notice = await screen.findByText(/cannot go back into “Q3 plan”/);
    expect(notice).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go back without changing the picture" }));
    expect(onClose).toHaveBeenCalledWith(null);
  });

  it("changes nothing for a viewer", async () => {
    const { back, onClose } = open(true);
    expect(screen.getByRole("status").textContent).toBe("View only");
    fireEvent.click(back);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(null));
  });

  it("keeps keys away from the file underneath", () => {
    const { source } = open();
    const underneath = vi.fn();
    window.addEventListener("keydown", underneath);
    try {
      fireEvent.keyDown(source, { key: "Delete" });
      fireEvent.keyDown(document.body, { key: "Delete" });
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", underneath);
    }
  });
});

describe("Drawing opened on a file a deck names", () => {
  it("is titled with that file", () => {
    render(<EmbeddedDrawing svg={SVG} name="media/logo.svg" parentTitle="Q3 plan" readOnly={false} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "media/logo.svg in Q3 plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to Q3 plan" })).toBeTruthy();
  });
});

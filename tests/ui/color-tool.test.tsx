// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColorTool, hsvToHex, hsvToRgb, parseHex, rgbToHex, rgbToHsv } from "../../apps/web/src/editors/color-picker";

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = () => {};
});
afterEach(cleanup);

function openTool(value = "#ff0000", props: Partial<Parameters<typeof ColorTool>[0]> = {}) {
  const onCommit = vi.fn();
  const view = render(
    <ColorTool label="Text color" value={value} onCommit={onCommit} {...props}>
      <span>A</span>
    </ColorTool>,
  );
  const button = screen.getByRole("button", { name: "Text color" });
  return { ...view, onCommit, button };
}

function box(el: Element, width = 100, height = 100) {
  (el as HTMLElement).getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  return el as HTMLElement;
}

const pointer = (el: Element, type: string, x: number, y: number, pointerId = 1) =>
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true }));
  });

const channel = (name: string) => (screen.getByLabelText(name) as HTMLInputElement).value;

describe("the color tool", () => {
  it("opens on the current color and closes again from its button", () => {
    const { button } = openTool("#ff8000");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Text color" })).toBeTruthy();
    expect([channel("Red"), channel("Green"), channel("Blue")]).toEqual(["255", "128", "0"]);
    expect(screen.getByRole("slider", { name: "Hue" }).getAttribute("aria-valuetext")).toBe("#ff8000");
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("previews while dragging the field and applies the color on release", () => {
    const { button, onCommit } = openTool();
    fireEvent.click(button);
    const field = box(screen.getByRole("application", { name: "Saturation and brightness" }));
    fireEvent.pointerDown(field, { pointerId: 1, clientX: 50, clientY: 50 });
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("#804040");
    pointer(field, "pointermove", 100, 0, 2);
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("#804040");
    pointer(field, "pointermove", 100, 0);
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("#ff0000");
    expect(onCommit).not.toHaveBeenCalled();
    pointer(field, "pointerup", 200, -20, 2);
    expect(onCommit).not.toHaveBeenCalled();
    pointer(field, "pointerup", 200, -20);
    expect(onCommit).toHaveBeenCalledWith("#ff0000");
    pointer(field, "pointermove", 0, 100);
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("#ff0000");
  });

  it("changes the hue, and a cancelled drag applies nothing", () => {
    const { button, onCommit } = openTool();
    fireEvent.click(button);
    const hue = box(screen.getByRole("slider", { name: "Hue" }));
    fireEvent.pointerDown(hue, { pointerId: 1, clientX: 50, clientY: 0 });
    expect(hue.getAttribute("aria-valuenow")).toBe("180");
    expect(hue.getAttribute("aria-valuetext")).toBe("#00ffff");
    pointer(hue, "pointercancel", 0, 0, 2);
    pointer(hue, "pointercancel", 0, 0);
    pointer(hue, "pointermove", 0, 0);
    expect(hue.getAttribute("aria-valuenow")).toBe("180");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("takes typed red, green, and blue values, clamped to a byte", () => {
    const { button, onCommit } = openTool("#000000");
    fireEvent.click(button);
    fireEvent.change(screen.getByLabelText("Green"), { target: { value: "300" } });
    expect(channel("Green")).toBe("255");
    fireEvent.blur(screen.getByLabelText("Green"));
    expect(onCommit).toHaveBeenLastCalledWith("#00ff00");
    fireEvent.change(screen.getByLabelText("Red"), { target: { value: "-4" } });
    fireEvent.keyDown(screen.getByLabelText("Red"), { key: "a" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Blue"), { target: { value: "128" } });
    fireEvent.keyDown(screen.getByLabelText("Blue"), { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith("#00ff80");
  });

  it("closes on Escape and on a press outside, but not inside", () => {
    const { button } = openTool();
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Tab" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays under its button and inside the window", () => {
    const { button } = openTool();
    button.getBoundingClientRect = () => new DOMRect(window.innerWidth - 20, 30, 20, 20);
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.top).toBe("56px");
    expect(dialog.style.left).toBe(`${window.innerWidth - 216 - 8}px`);
    button.getBoundingClientRect = () => new DOMRect(40, 100, 20, 20);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(dialog.style.left).toBe("40px");
    expect(dialog.style.top).toBe("126px");
  });

  it("does not open while disabled, and starts from black for an unreadable color", () => {
    const { button, unmount } = openTool("#ff0000", { disabled: true });
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    const other = openTool("not a color", { swatch: true });
    expect(other.container.querySelector<HTMLElement>(".color-swatch")).not.toBeNull();
    fireEvent.click(other.button);
    expect([channel("Red"), channel("Green"), channel("Blue")]).toEqual(["0", "0", "0"]);
    expect(other.container.querySelector<HTMLElement>(".color-swatch")!.style.backgroundColor).toBe("rgb(0, 0, 0)");
  });
});

describe("color conversions", () => {
  it("reads six-digit hex only", () => {
    expect(parseHex(" #0a0B0c ")).toEqual({ r: 10, g: 11, b: 12 });
    expect(parseHex("#abc")).toBeNull();
    expect(rgbToHex({ r: 300, g: -5, b: Number.NaN })).toBe("#ff0000");
  });

  it("turns each hue sextant into the right color and back", () => {
    const hues = [0, 60, 120, 180, 240, 300, -60];
    expect(hues.map((h) => hsvToHex({ h, s: 1, v: 1 }))).toEqual([
      "#ff0000",
      "#ffff00",
      "#00ff00",
      "#00ffff",
      "#0000ff",
      "#ff00ff",
      "#ff00ff",
    ]);
    expect(rgbToHsv({ r: 0, g: 255, b: 0 }).h).toBe(120);
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBe(240);
    expect(rgbToHsv({ r: 255, g: 0, b: 128 }).h).toBeCloseTo(329.9, 1);
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToRgb(rgbToHsv({ r: 18, g: 52, b: 86 }))).toEqual({ r: 18, g: 52, b: 86 });
  });
});

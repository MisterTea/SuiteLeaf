// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FadeOnClickMark } from "../../apps/web/src/editors/slide-fade-mark";
import { animationSequenceMap } from "../../apps/web/src/editors/slide-fade-in";

afterEach(cleanup);

describe("FadeOnClickMark", () => {
  it("renders null for an element without animation", () => {
    const { container } = render(<FadeOnClickMark element={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null for an element with unknown animation", () => {
    const { container } = render(<FadeOnClickMark element={{ animation: "unknown" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the magic dust symbol and the sequence number for an animated element", () => {
    const { container } = render(
      <FadeOnClickMark element={{ animation: "appear-on-click" }} sequence={1} />,
    );
    const mark = container.querySelector(".fade-on-click-mark");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("aria-label")).toBe("Animation 1");
    expect(mark?.getAttribute("title")).toBe("Animation 1");
    expect(mark?.textContent).toBe("1");

    // Has the Sparkles icon SVG
    const svg = mark?.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders higher sequence numbers such as 2 and 3", () => {
    const { container } = render(
      <FadeOnClickMark element={{ animation: "fly-on-click" }} sequence={3} />,
    );
    const mark = container.querySelector(".fade-on-click-mark");
    expect(mark?.textContent).toBe("3");
    expect(mark?.getAttribute("aria-label")).toBe("Animation 3");
  });

  it("falls back to animationOrder when sequence prop is omitted", () => {
    const { container } = render(
      <FadeOnClickMark element={{ animation: "fade-on-click", animationOrder: 2 }} />,
    );
    const mark = container.querySelector(".fade-on-click-mark");
    expect(mark?.textContent).toBe("2");
  });

  it("defaults to 1 when both sequence and animationOrder are omitted", () => {
    const { container } = render(
      <FadeOnClickMark element={{ animation: "fade-on-click" }} />,
    );
    const mark = container.querySelector(".fade-on-click-mark");
    expect(mark?.textContent).toBe("1");
  });
});

describe("animationSequenceMap", () => {
  it("numbers image and caption pairs by click rather than by object", () => {
    const elements = [1, 2, 3].flatMap((order) => [
      { id: `image-${order}`, animation: "appear-on-click", animationOrder: order },
      { id: `caption-${order}`, animation: "appear-on-click", animationOrder: order },
    ]);
    const map = animationSequenceMap(elements);
    expect([...map.values()]).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("keeps with/after effects on the same click and uses the first click for repeated objects", () => {
    const elements = [
      { id: "image", animation: "appear-on-click", animationOrder: 1, animationExit: { order: 4 } },
      { id: "caption", animation: "appear-on-click", animationOrder: 2, animationTrigger: "with" },
      { id: "credit", animation: "appear-on-click", animationOrder: 3, animationTrigger: "after" },
      { id: "next", animation: "appear-on-click", animationOrder: 5 },
    ];
    expect([...animationSequenceMap(elements)]).toEqual([
      ["image", 1], ["caption", 1], ["credit", 1], ["next", 3],
    ]);
  });

  it("returns an empty map for undefined or empty elements", () => {
    expect(animationSequenceMap(undefined).size).toBe(0);
    expect(animationSequenceMap([]).size).toBe(0);
  });

  it("assigns sequential 1-based numbers to animated elements on a slide", () => {
    const elements = [
      { id: "el1", animation: "appear-on-click" },
      { id: "el2" }, // no animation
      { id: "el3", animation: "fly-on-click" },
    ];
    const map = animationSequenceMap(elements);
    expect(map.get("el1")).toBe(1);
    expect(map.get("el2")).toBeUndefined();
    expect(map.get("el3")).toBe(2);
  });

  it("orders sequence numbers according to animationOrder", () => {
    const elements = [
      { id: "first-placed", animation: "appear-on-click", animationOrder: 2 },
      { id: "second-placed", animation: "fly-on-click", animationOrder: 1 },
    ];
    const map = animationSequenceMap(elements);
    // second-placed has animationOrder 1, so it is sequence 1
    expect(map.get("second-placed")).toBe(1);
    // first-placed has animationOrder 2, so it is sequence 2
    expect(map.get("first-placed")).toBe(2);
  });
});

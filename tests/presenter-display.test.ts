import { describe, expect, it } from "vitest";
import { advanceAfterMs, formatElapsed, nextSlideTitle, showAdvanceDelay, showFrame, shownElapsedMs, slideTitleText } from "../apps/web/src/editors/presenter-display";

describe("presenter and audience displays", () => {
  it("keeps speaker notes off the audience frame", () => {
    const frame = showFrame({
      slideIndex: 0,
      slideCount: 2,
      notes: "Say secret-value slowly",
      nextTitle: "Paths",
      elapsedMs: 65_000,
      blank: false,
    });
    expect(frame.audience).toEqual({ slideIndex: 0, blank: false });
    expect(JSON.stringify(frame.audience)).not.toContain("secret-value");
    expect(frame.presenter.notes).toBe("Say secret-value slowly");
    expect(frame.presenter.nextTitle).toBe("Paths");
    expect(frame.presenter.elapsedMs).toBe(65_000);
    expect(frame.presenter.ended).toBe(false);

    const end = showFrame({
      slideIndex: 1,
      slideCount: 2,
      notes: "Last note",
      nextTitle: "Extra",
      elapsedMs: -5,
      blank: true,
    });
    expect(end.audience).toEqual({ slideIndex: 1, blank: true });
    expect(end.presenter.nextTitle).toBeNull();
    expect(end.presenter.ended).toBe(true);
    expect(end.presenter.elapsedMs).toBe(0);
    expect(end.presenter.notes).toBe("Last note");
  });

  it("holds the timer while it is paused", () => {
    expect(shownElapsedMs(65_000, false, 10_000)).toBe(65_000);
    expect(shownElapsedMs(65_000, true, 10_000)).toBe(10_000);
    expect(shownElapsedMs(Number.NaN, true, -5)).toBe(0);
  });

  it("advances after whole seconds and waits when the show is blank or paused", () => {
    expect(advanceAfterMs(5)).toBe(5_000);
    expect(advanceAfterMs(0)).toBeNull();
    expect(advanceAfterMs(1.5)).toBeNull();
    expect(advanceAfterMs("secret-value")).toBeNull();
    expect(
      showAdvanceDelay({ presenting: true, blank: false, paused: false, seconds: 2 }),
    ).toBe(2_000);
    expect(showAdvanceDelay({ presenting: true, blank: true, paused: false, seconds: 2 })).toBeNull();
    expect(showAdvanceDelay({ presenting: false, blank: false, paused: false, seconds: 2 })).toBeNull();
    expect(showAdvanceDelay({ presenting: true, blank: false, paused: true, seconds: 2 })).toBeNull();
  });

  it("numbers the next visible slide when it has no heading", () => {
    expect(nextSlideTitle(2, undefined)).toBe("Slide 3");
    expect(nextSlideTitle(2, "  Beds  ")).toBe("Beds");
    expect(nextSlideTitle(null, "secret-value")).toBeNull();
    expect(JSON.stringify(nextSlideTitle(2, undefined))).not.toContain("secret-value");
    expect(
      slideTitleText(
        [{ type: "text", id: "box", placeholder: "title", content: "" }],
        [{ id: "master-title", placeholder: "title", content: "Garden club" }],
      ),
    ).toBe("Garden club");
    expect(
      slideTitleText(
        [{ type: "text", id: "box", placeholder: "title", content: "North" }],
        [{ id: "master-title", placeholder: "title", content: "secret-value" }],
      ),
    ).toBe("North");
  });

  it("shows hours after the timer passes one hour", () => {
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(3661)).toBe("1:01:01");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
    expect(formatElapsed(-4)).toBe("0:00");
  });
});
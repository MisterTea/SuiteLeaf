// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackButton } from "../../apps/web/src/feedback/FeedbackButton";
import { FeedbackDialog } from "../../apps/web/src/feedback/FeedbackDialog";
import {
  BUGCATCHER_URL,
  captureCurrentScreenshot,
  submitFeedbackIssue,
} from "../../apps/web/src/feedback/feedback-service";

const fetchMock = vi.fn();

beforeEach(() => {
  (window as any).suiteleaf = {
    captureScreenshot: vi.fn().mockResolvedValue("data:image/png;base64,fake-screenshot-data"),
  };
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, number: 42 }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as any).suiteleaf;
});

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

describe("FeedbackButton and FeedbackDialog", () => {
  it("captures a screenshot, shows it as a thumbnail, and closes on Cancel", async () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: /report bug or request feature/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(window.suiteleaf!.captureScreenshot).toHaveBeenCalledOnce();
    const img = screen.getByAltText(/screenshot of current application window/i) as HTMLImageElement;
    expect(img.src).toBe("data:image/png;base64,fake-screenshot-data");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks whether it is a bug report or a feature request", () => {
    render(<FeedbackDialog screenshot="" onClose={vi.fn()} />);
    const bug = screen.getByLabelText(/bug report/i) as HTMLInputElement;
    const feature = screen.getByLabelText(/new feature/i) as HTMLInputElement;
    expect(bug.checked).toBe(true);
    fireEvent.click(feature);
    expect(feature.checked).toBe(true);
    expect(bug.checked).toBe(false);
    fireEvent.click(bug);
    expect(bug.checked).toBe(true);
  });

  it("refuses to submit an empty description and clears error on typing", async () => {
    render(<FeedbackDialog screenshot="" onClose={vi.fn()} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/please write a description/i);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: "Valid description" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("posts the type, text and screenshot to Bugcatcher and shows the issue number", async () => {
    render(<FeedbackDialog screenshot="data:image/png;base64,test" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /bug details/i }), {
      target: { value: "Cells vanish when scrolling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect((await screen.findByText(/was filed as #42/i)).textContent).toMatch(/bug report/);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BUGCATCHER_URL}/report`);
    expect(sentBody()).toMatchObject({
      type: "bug",
      text: "Cells vanish when scrolling",
      screenshot: "data:image/png;base64,test",
    });
  });

  it("sends a feature request without a screenshot", async () => {
    render(<FeedbackDialog screenshot="" onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/new feature/i));
    fireEvent.change(screen.getByRole("textbox", { name: /feature details/i }), {
      target: { value: "CSV drag and drop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText(/feature request was filed/i);
    expect(sentBody().type).toBe("feature");
    expect(sentBody().screenshot).toBeUndefined();
  });

  it("shows the service's error message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "Screenshot is too large." }), { status: 413 }),
    );
    render(<FeedbackDialog screenshot="" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Screenshot is too large.");
  });

  it("closes on Cancel, Escape, and backdrop click", () => {
    const onClose = vi.fn();
    render(<FeedbackDialog screenshot="" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("captureCurrentScreenshot and submitFeedbackIssue", () => {
  it("falls back to canvas screenshot when desktop capture fails or is absent", async () => {
    window.suiteleaf!.captureScreenshot = vi.fn().mockRejectedValue(new Error("fail"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const box = document.createElement("div");
    box.textContent = "Hello";
    box.style.backgroundColor = "rgb(255, 255, 255)";
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => {},
    });
    document.body.appendChild(box);

    const ctx = { fillStyle: "", font: "", fillRect: vi.fn(), fillText: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,canvas");

    expect(await captureCurrentScreenshot()).toBe("data:image/png;base64,canvas");
    expect(ctx.fillText).toHaveBeenCalled();
    box.remove();
  });

  it("rejects empty text and explains a network failure", async () => {
    expect((await submitFeedbackIssue({ type: "bug", text: "  " })).success).toBe(false);
    const result = await submitFeedbackIssue(
      { type: "bug", text: "x" },
      vi.fn().mockRejectedValue(new TypeError("offline")),
    );
    expect(result).toEqual({ success: false, error: expect.stringMatching(/could not reach/i) });
  });

  it("reports an HTTP failure without a JSON body", async () => {
    const result = await submitFeedbackIssue(
      { type: "bug", text: "x" },
      vi.fn().mockResolvedValue(new Response("oops", { status: 500 })),
    );
    expect(result.error).toMatch(/HTTP 500/);
  });
});

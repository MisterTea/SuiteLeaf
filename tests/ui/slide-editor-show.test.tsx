// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { activeHost } from "../../apps/web/src/ai/host";
import { FADE_ON_CLICK } from "../../apps/web/src/editors/slide-fade-in";
import { requestFile } from "../../apps/web/src/ai/file-request";
import { exportBinary, exportText } from "../../apps/web/src/storage";
import { openSlides, pick, press, setupSlidesDom, words } from "./slide-editor-harness";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));
vi.mock("../../apps/web/src/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/web/src/storage")>()),
  exportText: vi.fn(async () => undefined),
  exportBinary: vi.fn(async () => undefined),
}));
vi.mock("../../apps/web/src/ai/file-request", () => ({ requestFile: vi.fn(async () => null) }));

setupSlidesDom();

const show = () => screen.getByRole("dialog", { name: "Slideshow" });
const counter = () => show().querySelector(".presenter-counter")?.textContent;
const control = (name: string | RegExp) => within(show()).getByRole("button", { name });

function threeSlides(extra: Parameters<typeof openSlides>[0] = {}) {
  return openSlides({
    slides: {
      a: [words("a-title", "Intro", { placeholder: "Click to add title" }), words("a-point", "Point", { y: 200 })],
      b: [words("b-title", "Plan", { placeholder: "Click to add title" })],
      c: [words("c-title", "Close", { placeholder: "Click to add title" })],
    },
    ...extra,
  });
}

describe("the slideshow", () => {
  it("steps through fade-ins and slides with the keys, blanks the screen, and ends with Escape", () => {
    const editor = threeSlides({
      edit: (deck) => {
        deck.slides.a.notes = "Welcome everyone";
        deck.slides.b.transition = { type: "fade", duration: 0.5 };
      },
    });
    pick("a-point");
    expect(editor.slide().fadeOnClickReason()).toBeUndefined();
    act(() => editor.slide().fadeOnClick());
    expect(editor.elements("a")[1].animation).toBeDefined();
    act(() => editor.slide().animate(null));
    expect(editor.elements("a")[1].animation).toBeUndefined();
    act(() => editor.slide().fadeOnClick());
    expect(editor.slide().animationReason(FADE_ON_CLICK)).toBe("This object already uses on click.");

    act(() => editor.actions().present!());
    expect(counter()).toBe("Slide 1 of 3");
    const point = () => show().querySelector('[data-element-id="a-point"]')!;
    expect(point().getAttribute("data-fade")).toBe("hidden");
    expect(control(/Next/).getAttribute("title")).toBe("Fade in (Right arrow)");
    expect(control(/Previous/)).toHaveProperty("disabled", true);
    press("ArrowRight");
    expect(counter()).toBe("Slide 1 of 3");
    expect(point().getAttribute("data-fade")).toBe("visible");
    expect(control(/Previous/).getAttribute("title")).toBe("Hide fade-in (Left arrow)");
    press(" ");
    expect(counter()).toBe("Slide 2 of 3");
    expect(show().querySelector(".show-slide")!.className).toContain("deck-motion-fade");
    press("End");
    expect(counter()).toBe("Slide 3 of 3");
    expect(control(/Next/)).toHaveProperty("disabled", true);
    press("PageUp");
    press("Home");
    expect(counter()).toBe("Slide 1 of 3");
    press("n");
    press("p");

    press("b");
    expect(show().querySelector<HTMLElement>(".presenter-blank")!.style.backgroundColor).toBe("rgb(0, 0, 0)");
    press(".");
    expect(show().querySelector(".presenter-blank")).toBeNull();
    press("w");
    expect(show().querySelector<HTMLElement>(".presenter-blank")!.style.backgroundColor).toBe("rgb(255, 255, 255)");
    press(",");
    press("B", { metaKey: true });
    press("x");
    expect(show().querySelector(".presenter-blank")).toBeNull();

    press("s");
    const notes = within(show()).getByRole("complementary", { name: "Speaker notes" });
    expect(notes.textContent).toContain("Welcome everyone");
    expect(notes.textContent).toContain("Next: Plan");
    press("End");
    expect(notes.textContent).toContain("No speaker notes for this slide.");
    expect(notes.textContent).toContain("End of presentation");
    press("S");
    expect(within(show()).queryByRole("complementary", { name: "Speaker notes" })).toBeNull();
    fireEvent.click(show().querySelector(".show-slide")!);
    press("Escape");
    expect(screen.queryByRole("dialog", { name: "Slideshow" })).toBeNull();
    expect(editor.active()).toBe("a");
  });

  it("uses the on-screen controls, pauses the timer, and opens the audience screen", () => {
    const editor = threeSlides();
    const popup = { closed: false, document: { open: vi.fn(), write: vi.fn(), close: vi.fn() } };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    act(() => editor.slide().presenterView());
    expect(within(show()).getByRole("complementary", { name: "Speaker notes" })).toBeTruthy();
    fireEvent.click(control("Pause timer"));
    fireEvent.click(control("Resume timer"));
    expect(control("Pause timer")).toBeTruthy();
    fireEvent.click(control(/Notes/));
    expect(within(show()).queryByRole("complementary", { name: "Speaker notes" })).toBeNull();

    fireEvent.click(control("Audience screen"));
    expect(window.open).toHaveBeenCalledWith("", "suiteleaf-audience");
    expect(popup.document.write.mock.lastCall?.[0]).toContain("Intro");
    fireEvent.click(control(/Next/));
    expect(counter()).toBe("Slide 2 of 3");
    expect(popup.document.write.mock.lastCall?.[0]).toContain("Plan");
    fireEvent.click(control(/Previous/));
    expect(counter()).toBe("Slide 1 of 3");

    const controls = show().querySelector(".presenter-controls")!;
    fireEvent.mouseEnter(controls);
    fireEvent.mouseLeave(controls);
    fireEvent.mouseMove(window);
    expect(controls.className).toContain("visible");
    fireEvent.click(control(/Exit/));
    expect(screen.queryByRole("dialog", { name: "Slideshow" })).toBeNull();
  });

  it("skips hidden slides and advances on its own after the slide's time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      const editor = threeSlides({
        edit: (deck) => {
          deck.slides.a.advanceSeconds = 2;
          deck.slides.b.hidden = true;
        },
      });
      act(() => editor.slide().presenterView());
      expect(counter()).toBe("Slide 1 of 3");
      const controls = show().querySelector(".presenter-controls")!;
      act(() => vi.advanceTimersByTime(2600));
      expect(counter()).toBe("Slide 3 of 3");
      expect(controls.className).toContain("hidden");
      expect(show().querySelector(".presenter-timer")?.textContent).toMatch(/0:0[23]/);
      press("ArrowLeft");
      expect(counter()).toBe("Slide 1 of 3");
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the browser's full screen and leaves it when the show ends", async () => {
    const root = document.documentElement;
    let full: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => full });
    const exit = vi.fn(async () => {
      full = null;
    });
    Object.assign(document, { exitFullscreen: exit });
    root.requestFullscreen = vi.fn(async () => {
      full = root;
    });
    try {
      const editor = threeSlides();
      act(() => editor.slide().presenterView());
      await act(async () => {});
      expect(root.requestFullscreen).toHaveBeenCalled();
      full = null;
      act(() => void document.dispatchEvent(new Event("fullscreenchange")));
      expect(screen.queryByRole("dialog", { name: "Slideshow" })).toBeNull();

      act(() => editor.actions().present!());
      await act(async () => {});
      press("Escape");
      expect(exit).toHaveBeenCalled();

      root.requestFullscreen = vi.fn(async () => {
        throw new Error("denied");
      });
      act(() => editor.actions().present!());
      await act(async () => {});
      fireEvent.click(control(/Exit/));
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      delete (document as { fullscreenElement?: unknown }).fullscreenElement;
      delete (document as { exitFullscreen?: unknown }).exitFullscreen;
      delete (root as { requestFullscreen?: unknown }).requestFullscreen;
    }
  });

  it("records the show to a video and saves it when stopped or when the show ends", async () => {
    const context = {
      canvas: { width: 960, height: 540 },
      fillRect: vi.fn(),
      fillText: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: "",
      font: "",
      textBaseline: "",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    Object.assign(HTMLCanvasElement.prototype, { captureStream: () => ({}) });
    class FakeRecorder {
      static isTypeSupported = (type: string) => type.includes("vp9");
      state = "inactive";
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: unknown, options: { mimeType: string }) {
        this.mimeType = options.mimeType;
      }
      start() {
        this.state = "recording";
        this.ondataavailable?.({ data: new Blob([]) });
        this.ondataavailable?.({ data: new Blob(["frame"]) });
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    const editor = threeSlides({ title: "Talk" });
    act(() => editor.actions().present!());
    fireEvent.click(control("Record"));
    expect(control("Stop recording").getAttribute("aria-pressed")).toBe("true");
    expect(context.fillText).toHaveBeenCalledWith("Intro", expect.any(Number), expect.any(Number));
    press("ArrowRight");
    expect(context.fillText).toHaveBeenCalledWith("Plan", expect.any(Number), expect.any(Number));
    fireEvent.click(control("Stop recording"));
    await waitFor(() => expect(exportBinary).toHaveBeenCalledWith("Talk.webm", expect.any(Uint8Array), "video/webm;codecs=vp9"));

    fireEvent.click(control("Record"));
    press("Escape");
    await waitFor(() => expect(exportBinary).toHaveBeenCalledTimes(2));

    vi.stubGlobal("MediaRecorder", class extends FakeRecorder {
      start(): void {
        throw new Error("No recorder");
      }
    });
    act(() => editor.actions().present!());
    fireEvent.click(control("Record"));
    expect(control("Record").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("the assistant's slide tools", () => {
  const tool = (name: string) => activeHost()!.tools.find((item) => item.name === name)!;

  it("describes the deck, copies and pastes objects, presents, and exports", async () => {
    const editor = threeSlides({ title: "Pitch" });
    const host = activeHost()!;
    expect(host.kind).toBe("slide");
    expect(host.snapshot()).toContain('Open presentation: "Pitch", 3 slide(s)');
    expect(host.review?.()).toEqual([]);

    await act(() => tool("copy_element").execute({ slide: "1" }));
    const pasted = await act(() => tool("paste_element").execute({ slide: "2" }));
    expect(String(pasted)).toContain("onto slide 2");
    expect(editor.elements("b")).toHaveLength(2);
    expect(editor.active()).toBe("b");

    await act(() => tool("go_to_slide").execute({ slide: 3 }));
    expect(editor.active()).toBe("c");

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const started = act(() => tool("start_presentation").execute({ from_slide: 1, with_notes: true }));
    await act(async () => vi.advanceTimersByTime(700));
    vi.useRealTimers();
    expect(String(await started)).toContain("from slide 1 of 3");
    expect(counter()).toBe("Slide 1 of 3");
    await act(() => tool("next_slide").execute({}));
    expect(counter()).toBe("Slide 2 of 3");
    await act(() => tool("go_to_slide").execute({ slide: 3 }));
    expect(counter()).toBe("Slide 3 of 3");
    await act(() => tool("end_presentation").execute({}));
    expect(screen.queryByRole("dialog", { name: "Slideshow" })).toBeNull();

    for (const format of ["txt", "html", "pptx"]) await act(() => tool("export_presentation").execute({ format }));
    expect(vi.mocked(exportText).mock.calls.map((call) => call[0])).toEqual(["Pitch.txt", "Pitch.html"]);
    expect(vi.mocked(exportBinary).mock.lastCall?.[0]).toBe("Pitch.pptx");
  });

  it("reads a chosen picture onto the slide and refuses one that is too large", async () => {
    const editor = threeSlides();
    vi.mocked(requestFile).mockResolvedValueOnce(new File(["png"], "cat.png", { type: "image/png" }));
    await act(() => tool("insert_image").execute({ slide: 1 }));
    expect(editor.elements("a").at(-1)).toMatchObject({ type: "image", alt: "cat.png" });
    const huge = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 6 * 1024 * 1024 });
    vi.mocked(requestFile).mockResolvedValueOnce(huge);
    await expect(tool("insert_image").execute({ slide: 1 })).rejects.toThrow("smaller than 5 MB");
    vi.mocked(requestFile).mockResolvedValueOnce(new File(["png"], "bad.png", { type: "image/png" }));
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementationOnce(function (this: FileReader) {
      this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>);
    });
    await expect(tool("insert_image").execute({ slide: 1 })).rejects.toThrow("Could not read that image.");
    expect(tool("paste_element")).toBeDefined();
  });

  it("finds nothing to paste before something is copied", async () => {
    threeSlides();
    expect(() => tool("paste_element").execute({ slide: "2" })).toThrow("Nothing is copied");
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Slide } from "@suiteleaf/core";
import { slideDrawOps, paintOps, RecordingTimeline, RecordingError, handleRecordingError, validateVideoContainer } from "../apps/web/src/editors/slide-record";

describe("slideshow recording", () => {
  it("draws the background, master text, and the slide title", () => {
    const slide: Slide = {
      id: "s",
      elements: [
        { id: "title", type: "text", x: 40, y: 40, width: 400, height: 80, content: "Welcome", fontSize: 32 },
      ],
      background: { color: "#111111" },
    };
    const ops = slideDrawOps(
      slide,
      960,
      540,
      960,
      540,
      [{ id: "foot", type: "text", x: 40, y: 480, width: 200, height: 32, content: "Club" }],
    );
    expect(ops[0]).toEqual({ kind: "fill", color: "#111111" });
    expect(ops.filter((op) => op.kind === "text").map((op) => (op.kind === "text" ? op.text : ""))).toEqual([
      "Club",
      "Welcome",
    ]);
  });

  it("draws a shape and a picture after the master", () => {
    const slide: Slide = {
      id: "s",
      background: { color: "#ffffff" },
      elements: [
        { id: "box", type: "shape", x: 10, y: 10, width: 40, height: 20, fill: "#2563eb" },
        {
          id: "logo",
          type: "image",
          x: 80,
          y: 10,
          width: 30,
          height: 30,
          src: "data:image/png;base64,aaaa",
        },
      ],
    };
    const ops = slideDrawOps(slide, 100, 50, 100, 50, [
      { id: "foot", type: "text", x: 0, y: 40, width: 20, height: 10, content: "Club" },
    ]);
    expect(ops.map((op) => op.kind)).toEqual(["fill", "text", "rect", "image"]);
    expect(ops.find((op) => op.kind === "rect")).toMatchObject({ color: "#2563eb" });
    expect(ops.find((op) => op.kind === "image")).toMatchObject({
      src: "data:image/png;base64,aaaa",
    });
  });

  it("fills a slide that has no background with the master color", () => {
    const slide: Slide = {
      id: "s",
      elements: [
        { id: "title", type: "text", x: 40, y: 40, width: 400, height: 80, content: "Welcome" },
      ],
    };
    const ops = slideDrawOps(
      slide,
      960,
      540,
      960,
      540,
      [{ id: "foot", type: "text", x: 40, y: 480, width: 200, height: 32, content: "Club" }],
      "#0d2818",
    );
    expect(ops[0]).toEqual({ kind: "fill", color: "#0d2818" });
    expect(slideDrawOps({ ...slide, background: { color: "#111111" } }, 960, 540, 960, 540, [], "#0d2818")[0]).toEqual({
      kind: "fill",
      color: "#111111",
    });
  });

  it("renders shapes, styled text runs, tables, and media elements with captions", () => {
    const slide: Slide = {
      id: "deck-slide",
      elements: [
        {
          id: "round-shape",
          type: "shape",
          shapeType: "rect",
          radius: 12,
          x: 10,
          y: 10,
          width: 100,
          height: 50,
          fill: "#3b82f6",
          stroke: "#1d4ed8",
          strokeWidth: 2,
        },
        {
          id: "ellipse-shape",
          type: "shape",
          shapeType: "ellipse",
          x: 120,
          y: 10,
          width: 60,
          height: 60,
          fill: "#10b981",
        },
        {
          id: "line-shape",
          type: "shape",
          shapeType: "line",
          x: 10,
          y: 80,
          width: 200,
          height: 0,
          stroke: "#64748b",
          strokeWidth: 3,
        },
        {
          id: "styled-text",
          type: "text",
          x: 10,
          y: 100,
          width: 300,
          height: 40,
          runs: [
            { text: "Bold Part", bold: true, color: "#dc2626", fontSize: 20 },
            { text: " Italic Part", italic: true, color: "#16a34a", fontSize: 18 },
          ],
        },
        {
          id: "data-table",
          type: "table",
          x: 10,
          y: 160,
          width: 400,
          height: 100,
          rows: [
            ["Metric", "Value"],
            ["Q1 Revenue", "$100k"],
          ],
          cellMarks: [
            [{ bold: true, fill: "#f1f5f9" }, { bold: true, fill: "#f1f5f9" }],
            [{}, {}],
          ],
        },
        {
          id: "intro-video",
          type: "video",
          x: 10,
          y: 280,
          width: 320,
          height: 180,
          src: "video.mp4",
          caption: "Overview of garden plots",
        },
      ],
    };

    const ops = slideDrawOps(slide, 960, 540, 960, 540);
    expect(ops.find((op) => op.kind === "rect" && op.radius === 12)).toBeDefined();
    expect(ops.find((op) => op.kind === "ellipse")).toBeDefined();
    expect(ops.find((op) => op.kind === "line")).toBeDefined();

    const textOps = ops.filter((op) => op.kind === "text");
    expect(textOps.some((op) => op.kind === "text" && op.text === "Bold Part" && op.bold)).toBe(true);
    expect(textOps.some((op) => op.kind === "text" && op.text === " Italic Part" && op.italic)).toBe(true);

    const tableOp = ops.find((op) => op.kind === "table");
    expect(tableOp).toBeDefined();
    if (tableOp && tableOp.kind === "table") {
      expect(tableOp.rows[0]).toEqual(["Metric", "Value"]);
    }

    const mediaOp = ops.find((op) => op.kind === "media");
    expect(mediaOp).toBeDefined();
    if (mediaOp && mediaOp.kind === "media") {
      expect(mediaOp.mediaType).toBe("video");
      expect(mediaOp.caption).toBe("Overview of garden plots");
    }
  });

  it("filters elements according to the animation sequence step", () => {
    const slide: Slide = {
      id: "anim-slide",
      elements: [
        { id: "base", type: "text", x: 10, y: 10, width: 100, height: 30, content: "Always here" },
        {
          id: "step1",
          type: "text",
          x: 10,
          y: 50,
          width: 100,
          height: 30,
          content: "Entrance at step 1",
          animation: "appear-on-click",
          animationOrder: 1,
        },
        {
          id: "step2",
          type: "text",
          x: 10,
          y: 90,
          width: 100,
          height: 30,
          content: "Entrance at step 2",
          animation: "fly-on-click",
          animationOrder: 2,
        },
        {
          id: "exit-early",
          type: "text",
          x: 10,
          y: 130,
          width: 100,
          height: 30,
          content: "Exits on step 1",
          animationExit: { order: 1 },
        },
      ],
    };

    // Step 0: base is visible, exit-early is visible, step1 and step2 are not yet visible
    const ops0 = slideDrawOps(slide, 960, 540, 960, 540, undefined, undefined, 0);
    const texts0 = ops0.filter((op) => op.kind === "text").map((op) => (op.kind === "text" ? op.text : ""));
    expect(texts0).toContain("Always here");
    expect(texts0).toContain("Exits on step 1");
    expect(texts0).not.toContain("Entrance at step 1");
    expect(texts0).not.toContain("Entrance at step 2");

    // Step 1: base and step1 are visible, exit-early has exited, step2 is not yet visible
    const ops1 = slideDrawOps(slide, 960, 540, 960, 540, undefined, undefined, 1);
    const texts1 = ops1.filter((op) => op.kind === "text").map((op) => (op.kind === "text" ? op.text : ""));
    expect(texts1).toContain("Always here");
    expect(texts1).toContain("Entrance at step 1");
    expect(texts1).not.toContain("Exits on step 1");
    expect(texts1).not.toContain("Entrance at step 2");

    // Step 2: base, step1, and step2 are visible
    const ops2 = slideDrawOps(slide, 960, 540, 960, 540, undefined, undefined, 2);
    const texts2 = ops2.filter((op) => op.kind === "text").map((op) => (op.kind === "text" ? op.text : ""));
    expect(texts2).toContain("Always here");
    expect(texts2).toContain("Entrance at step 1");
    expect(texts2).toContain("Entrance at step 2");
    expect(texts2).not.toContain("Exits on step 1");
  });

  it("never silently omits unsupported elements and outputs diagnostic box", () => {
    const corruptedSlide = {
      id: "corrupted",
      elements: [
        {
          id: "unknown-1",
          type: "3d-hologram" as any,
          x: 50,
          y: 50,
          width: 200,
          height: 100,
        },
      ],
    };
    const ops = slideDrawOps(corruptedSlide as any, 960, 540, 960, 540);
    const unsupportedOp = ops.find((op) => op.kind === "unsupported");
    expect(unsupportedOp).toBeDefined();
    if (unsupportedOp && unsupportedOp.kind === "unsupported") {
      expect(unsupportedOp.message).toContain("Unsupported element type: 3d-hologram");
    }
  });

  it("tracks synchronization between slide keyframes and narration timeline within documented tolerance", () => {
    const timeline = new RecordingTimeline();

    // Slide 0: advance at 0 ms, narration starts at 10 ms (drift 10 ms)
    timeline.recordSlideAdvance(0, 0, 1000);
    timeline.addNarrationSegment({ id: "nar-0", slideIndex: 0, startMs: 1010, endMs: 4000 });

    // Slide 1: advance at 4000 ms, narration starts at 4025 ms (drift 25 ms)
    timeline.recordSlideAdvance(1, 0, 5000);
    timeline.addNarrationSegment({ id: "nar-1", slideIndex: 1, startMs: 5025, endMs: 8000 });

    const syncCheck = timeline.validateSync(50);
    expect(syncCheck.synchronized).toBe(true);
    expect(syncCheck.maxDriftMs).toBe(25);
    expect(syncCheck.driftPerSlide[0]).toBe(10);
    expect(syncCheck.driftPerSlide[1]).toBe(25);

    // If drift exceeds tolerance (e.g. 75 ms), reports out of sync
    timeline.recordSlideAdvance(2, 0, 9000);
    timeline.addNarrationSegment({ id: "nar-2", slideIndex: 2, startMs: 9075, endMs: 12000 });
    const exceededSync = timeline.validateSync(50);
    expect(exceededSync.synchronized).toBe(false);
    expect(exceededSync.maxDriftMs).toBe(75);
  });

  it("supports pause, resume, retake segment replacement, and WebVTT caption generation", () => {
    const timeline = new RecordingTimeline();
    timeline.recordSlideAdvance(0, 0, 0);
    timeline.addNarrationSegment({ id: "seg-1", slideIndex: 0, startMs: 0, endMs: 3000 });

    // Pause for 2000 ms then resume
    timeline.pause(3000);
    expect(timeline.isPaused()).toBe(true);
    timeline.resume(5000);
    expect(timeline.isPaused()).toBe(false);

    // Next slide advanced at raw 6000 ms, adjusted for paused duration to 4000 ms
    const kf1 = timeline.recordSlideAdvance(1, 0, 6000);
    expect(kf1.timestampMs).toBe(4000);

    // Retake / segment replacement
    const replaced = timeline.replaceSegment("seg-1", {
      id: "seg-1",
      slideIndex: 0,
      startMs: 0,
      endMs: 3000,
      dataLength: 48000,
    });
    expect(replaced).toBe(true);
    expect(timeline.narrationSegments[0].dataLength).toBe(48000);

    // WebVTT caption generation from speaker notes
    const vtt = timeline.generateWebVTT({
      0: "Welcome to the garden presentation.",
      1: "Here are the tomato bed yields.",
    });
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("Welcome to the garden presentation.");
    expect(vtt).toContain("Here are the tomato bed yields.");
  });

  it("handles recoverable recording errors and preserves recorded video chunks without leaking secrets", () => {
    const chunk = new Blob(["video data chunk"], { type: "video/webm" });

    // 1. Permission denial
    const permErr = handleRecordingError(new Error("NotAllowedError: user denied permission"), [chunk]);
    expect(permErr.code).toBe("PERMISSION_DENIED");
    expect(permErr.recoverable).toBe(true);
    expect(permErr.partialVideo).not.toBeNull();
    expect(permErr.message).toContain("permission was denied");

    // 2. Disk exhaustion
    const diskErr = handleRecordingError(new Error("QuotaExceededError: storage full"), [chunk]);
    expect(diskErr.code).toBe("DISK_EXHAUSTION");
    expect(diskErr.recoverable).toBe(true);
    expect(diskErr.partialVideo).not.toBeNull();

    // 3. Interrupted capture
    const captureErr = handleRecordingError(new Error("AbortError: capture stream closed"), [chunk]);
    expect(captureErr.code).toBe("INTERRUPTED_CAPTURE");
    expect(captureErr.recoverable).toBe(true);

    // 4. Unsupported codec
    const codecErr = handleRecordingError(new RecordingError("UNSUPPORTED_CODEC", "video/webm;codecs=av1 is not supported"), [chunk]);
    expect(codecErr.code).toBe("UNSUPPORTED_CODEC");
    expect(codecErr.recoverable).toBe(true);

    // Secret redaction
    const secretErr = handleRecordingError(new Error("Connection to secret-value.service aborted"), [chunk]);
    expect(secretErr.message).not.toContain("secret-value");

    // Unknown error
    const unknownErr = handleRecordingError({ custom: "odd error" });
    expect(unknownErr.code).toBe("UNKNOWN");
    expect(unknownErr.recoverable).toBe(true);
    expect(unknownErr.partialVideo).toBeNull();
  });

  it("validates video containers and target player compatibility", () => {
    const webmBlob = new Blob(["mock-ebml-header-and-video-payload"], { type: "video/webm" });

    // Chrome and Firefox support WebM
    const chromeCheck = validateVideoContainer(webmBlob, "chrome");
    expect(chromeCheck.valid).toBe(true);
    expect(chromeCheck.playerSupported).toBe(true);
    expect(chromeCheck.warnings).toHaveLength(0);

    const vlcCheck = validateVideoContainer(webmBlob, "vlc");
    expect(vlcCheck.valid).toBe(true);
    expect(vlcCheck.playerSupported).toBe(true);

    // QuickTime natively requires MP4/QuickTime, warns about WebM container
    const qtCheck = validateVideoContainer(webmBlob, "quicktime");
    expect(qtCheck.playerSupported).toBe(false);
    expect(qtCheck.warnings[0]).toContain("does not natively support container format 'video/webm'");

    // Empty blob failure
    const emptyBlob = new Blob([], { type: "video/webm" });
    const emptyCheck = validateVideoContainer(emptyBlob);
    expect(emptyCheck.valid).toBe(false);
    expect(emptyCheck.warnings).toContain("Video file is empty (0 bytes).");
  });

  it("paints canvas elements without error", () => {
    const ops = [
      { kind: "fill" as const, color: "#ffffff" },
      { kind: "rect" as const, x: 10, y: 10, w: 50, h: 50, color: "#2563eb", stroke: "#000", strokeWidth: 1 },
      { kind: "ellipse" as const, cx: 30, cy: 30, rx: 20, ry: 20, color: "#10b981" },
      { kind: "line" as const, x1: 0, y1: 0, x2: 100, y2: 100, color: "#000", strokeWidth: 2 },
      { kind: "text" as const, text: "Sample", x: 10, y: 40, size: 16, color: "#000", underline: true },
      {
        kind: "table" as const,
        x: 10,
        y: 60,
        w: 100,
        h: 40,
        rows: [["A", "B"]],
        cellMarks: [[{ bold: true, fill: "#eee" }, {}]],
      },
      { kind: "media" as const, x: 10, y: 110, w: 80, h: 40, mediaType: "video" as const, caption: "Test" },
      { kind: "unsupported" as const, x: 10, y: 160, w: 80, h: 20, message: "Err" },
    ];

    const mockCtx = {
      canvas: { width: 960, height: 540 },
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textBaseline: "",
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      ellipse: () => {},
      fill: () => {},
      stroke: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillText: () => {},
      measureText: (txt: string) => ({ width: txt.length * 8 }),
      setLineDash: () => {},
    } as unknown as CanvasRenderingContext2D;

    expect(() => paintOps(mockCtx, ops)).not.toThrow();
  });

  it("exercises SlideshowRecorder lifecycle and chunk caching", async () => {
    const { SlideshowRecorder } = await import("../apps/web/src/editors/slide-record");
    const rec = new SlideshowRecorder(960, 540);
    expect(rec.canvas.width).toBe(960);
    expect(rec.canvas.height).toBe(540);
    expect(rec.timeline).toBeDefined();

    // Painting with no context does not crash
    rec.paint({ id: "s", elements: [] }, 960, 540);

    // Initial chunks are empty
    expect(rec.getRecordedChunks()).toEqual([]);

    // Stopping while inactive returns an empty webm blob
    const stoppedBlob = await rec.stop();
    expect(stoppedBlob.type).toBe("video/webm");

    // Start with mocked MediaRecorder if in environment
    const origMediaRecorder = (globalThis as any).MediaRecorder;
    try {
      (globalThis as any).MediaRecorder = class MockMediaRecorder {
        state = "recording";
        mimeType = "video/webm";
        ondataavailable = null;
        onstop = null;
        constructor() {
          setTimeout(() => {
            if (this.ondataavailable) {
              (this.ondataavailable as any)({ data: new Blob(["chunk1"], { type: "video/webm" }) });
            }
          }, 10);
        }
        static isTypeSupported(type: string) {
          return type.includes("webm");
        }
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          if (this.onstop) (this.onstop as any)();
        }
      };

      // Mock canvas captureStream
      rec.canvas.captureStream = () => ({}) as any;

      rec.start();
      await new Promise((r) => setTimeout(r, 20));
      expect(rec.getRecordedChunks().length).toBeGreaterThanOrEqual(1);

      const finalBlob = await rec.stop();
      expect(finalBlob.type).toBe("video/webm");
      expect(finalBlob.size).toBeGreaterThan(0);
    } finally {
      (globalThis as any).MediaRecorder = origMediaRecorder;
    }
  });
});

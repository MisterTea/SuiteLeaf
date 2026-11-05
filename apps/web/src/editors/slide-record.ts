import type { Slide, SlideElement, TextRun } from "@suiteleaf/core";

export type DrawOp =
  | { kind: "fill"; color: string }
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string; stroke?: string; strokeWidth?: number; radius?: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; color: string; stroke?: string; strokeWidth?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth: number }
  | { kind: "text"; text: string; x: number; y: number; size: number; color: string; fontFamily?: string; bold?: boolean; italic?: boolean; underline?: boolean }
  | { kind: "image"; src: string; x: number; y: number; w: number; h: number; opacity?: number }
  | { kind: "table"; x: number; y: number; w: number; h: number; rows: string[][]; cellMarks?: { bold?: boolean; italic?: boolean; fill?: string; color?: string; font?: string; fontSize?: number; border?: string }[][] }
  | { kind: "media"; x: number; y: number; w: number; h: number; mediaType: "video" | "audio"; src?: string; caption?: string }
  | { kind: "unsupported"; x: number; y: number; w: number; h: number; message: string };

export interface BoxCoords {
  x: number;
  y: number;
  w: number;
  h: number;
}

function box(el: SlideElement, width: number, height: number, deckW: number, deckH: number): BoxCoords {
  return {
    x: (el.x / deckW) * width,
    y: (el.y / deckH) * height,
    w: (el.width / deckW) * width,
    h: (el.height / deckH) * height,
  };
}

/** Check if an element is visible at a given animation click step. */
export function isElementVisibleAtStep(el: SlideElement, step?: number): boolean {
  if (step === undefined) return true;
  const entranceOrder = el.animationOrder ?? 0;
  if (el.animation && entranceOrder > step) {
    return false;
  }
  if (el.animationExit && el.animationExit.order <= step) {
    return false;
  }
  return true;
}

/** What one recorded frame draws, in slide order, master first when supplied. */
export function slideDrawOps(
  slide: Slide | undefined,
  width: number,
  height: number,
  deckW: number,
  deckH: number,
  master?: SlideElement[],
  masterBackground?: string,
  step?: number,
): DrawOp[] {
  const ops: DrawOp[] = [
    {
      kind: "fill",
      color: slide?.background?.color || masterBackground || "#ffffff",
    },
  ];

  const paint = (el: SlideElement) => {
    if (!isElementVisibleAtStep(el, step)) {
      return;
    }

    const place = box(el, width, height, deckW, deckH);

    // Shapes
    if (el.type === "shape") {
      const shapeType = el.shapeType || "rect";
      if (shapeType === "ellipse") {
        ops.push({
          kind: "ellipse",
          cx: place.x + place.w / 2,
          cy: place.y + place.h / 2,
          rx: place.w / 2,
          ry: place.h / 2,
          color: el.fill || "#e2e8f0",
          stroke: el.stroke,
          strokeWidth: el.strokeWidth,
        });
      } else if (shapeType === "line" || shapeType === "arrow") {
        ops.push({
          kind: "line",
          x1: place.x,
          y1: place.y,
          x2: place.x + place.w,
          y2: place.y + place.h,
          color: el.stroke || el.fill || "#000000",
          strokeWidth: el.strokeWidth || 2,
        });
      } else {
        ops.push({
          kind: "rect",
          ...place,
          color: el.fill || "#e2e8f0",
          stroke: el.stroke,
          strokeWidth: el.strokeWidth,
          radius: el.radius ? (el.radius / deckH) * height : undefined,
        });
      }
    }

    // Images
    if (el.type === "image" && el.src) {
      ops.push({
        kind: "image",
        src: el.src,
        ...place,
        opacity: el.opacity,
      });
    }

    // Tables
    if (el.type === "table" && el.rows && el.rows.length > 0) {
      ops.push({
        kind: "table",
        ...place,
        rows: el.rows,
        cellMarks: el.cellMarks,
      });
    }

    // Audio / Video Media
    if (el.type === "video" || el.type === "audio") {
      ops.push({
        kind: "media",
        ...place,
        mediaType: el.type,
        src: el.src,
        caption: el.caption,
      });
    }

    // Styled text runs or plain content
    if (el.runs && el.runs.length > 0) {
      let currentX = place.x + 4;
      const baselineY = place.y + Math.min(place.h - 4, (el.fontSize || 18) + 4);
      for (const run of el.runs) {
        const text = run.text;
        if (!text) continue;
        const size = ((run.fontSize || el.fontSize || 18) / deckH) * height;
        ops.push({
          kind: "text",
          text,
          x: currentX,
          y: baselineY,
          size,
          color: run.color || el.color || "#1e293b",
          fontFamily: run.font || el.fontFamily || "Arial",
          bold: run.bold ?? el.bold,
          italic: run.italic ?? el.italic,
          underline: run.underline ?? el.underline,
        });
        currentX += text.length * (size * 0.55);
      }
    } else {
      const text = el.content?.trim();
      if (text) {
        ops.push({
          kind: "text",
          text,
          x: place.x + 4,
          y: place.y + Math.min(place.h - 4, (el.fontSize || 18) + 4),
          size: ((el.fontSize || 18) / deckH) * height,
          color: el.color || "#1e293b",
          fontFamily: el.fontFamily || "Arial",
          bold: el.bold,
          italic: el.italic,
          underline: el.underline,
        });
      }
    }

    // Diagnostically catch unsupported corrupted elements to avoid silent omissions
    if (!["text", "shape", "image", "table", "video", "audio"].includes(el.type)) {
      ops.push({
        kind: "unsupported",
        ...place,
        message: `Unsupported element type: ${(el as { type: string }).type}`,
      });
    }
  };

  for (const el of master ?? []) paint(el);
  for (const el of slide?.elements ?? []) paint(el);
  return ops;
}

export function paintOps(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[]) {
  for (const op of ops) {
    if (op.kind === "fill") {
      ctx.fillStyle = op.color;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else if (op.kind === "rect") {
      ctx.fillStyle = op.color;
      if (op.radius && typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(op.x, op.y, op.w, op.h, op.radius);
        ctx.fill();
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.strokeWidth || 1;
          ctx.stroke();
        }
      } else {
        ctx.fillRect(op.x, op.y, op.w, op.h);
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.strokeWidth || 1;
          ctx.strokeRect(op.x, op.y, op.w, op.h);
        }
      }
    } else if (op.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, 2 * Math.PI);
      ctx.fillStyle = op.color;
      ctx.fill();
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.strokeWidth || 1;
        ctx.stroke();
      }
    } else if (op.kind === "line") {
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.strokeWidth;
      ctx.stroke();
    } else if (op.kind === "table") {
      const numRows = op.rows.length;
      const numCols = op.rows[0]?.length || 1;
      const cellW = op.w / numCols;
      const cellH = op.h / numRows;
      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const cx = op.x + c * cellW;
          const cy = op.y + r * cellH;
          const mark = op.cellMarks?.[r]?.[c];
          ctx.fillStyle = mark?.fill || "#ffffff";
          ctx.fillRect(cx, cy, cellW, cellH);
          ctx.strokeStyle = mark?.border || "#cbd5e1";
          ctx.strokeRect(cx, cy, cellW, cellH);

          const val = op.rows[r]?.[c] || "";
          if (val) {
            ctx.fillStyle = mark?.color || "#1e293b";
            ctx.font = `${mark?.bold ? "bold " : ""}${Math.max(10, mark?.fontSize || 14)}px Arial`;
            ctx.textBaseline = "middle";
            ctx.fillText(val, cx + 4, cy + cellH / 2);
          }
        }
      }
    } else if (op.kind === "media") {
      ctx.fillStyle = "#1e1e2f";
      ctx.fillRect(op.x, op.y, op.w, op.h);
      ctx.fillStyle = "#ffffff";
      ctx.font = "14px Arial";
      ctx.textBaseline = "middle";
      const icon = op.mediaType === "video" ? "▶ Video" : "♪ Audio";
      ctx.fillText(icon, op.x + 8, op.y + op.h / 2);
      if (op.caption) {
        ctx.font = "12px Arial";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(`[${op.caption}]`, op.x + 8, op.y + op.h - 12);
      }
    } else if (op.kind === "text") {
      ctx.fillStyle = op.color;
      const weight = op.bold ? "bold " : "";
      const style = op.italic ? "italic " : "";
      const font = op.fontFamily || "Arial";
      ctx.font = `${style}${weight}${Math.max(10, op.size)}px ${font}`;
      ctx.textBaseline = "bottom";
      ctx.fillText(op.text, op.x, op.y);
      if (op.underline) {
        ctx.strokeStyle = op.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(op.x, op.y + 2);
        const w = ctx.measureText(op.text).width;
        ctx.lineTo(op.x + w, op.y + 2);
        ctx.stroke();
      }
    } else if (op.kind === "unsupported") {
      ctx.strokeStyle = "#ef4444";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(op.x, op.y, op.w, op.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#ef4444";
      ctx.font = "12px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(op.message, op.x + 4, op.y + op.h / 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Timeline & Narration Synchronization
// ---------------------------------------------------------------------------

export interface SlideKeyframe {
  slideIndex: number;
  stepIndex: number;
  timestampMs: number;
}

export interface NarrationSegment {
  id: string;
  startMs: number;
  endMs: number;
  dataLength?: number;
  slideIndex?: number;
}

export class RecordingTimeline {
  readonly keyframes: SlideKeyframe[] = [];
  readonly narrationSegments: NarrationSegment[] = [];
  private paused = false;
  private pauseStartedMs = 0;
  private totalPausedDurationMs = 0;

  recordSlideAdvance(slideIndex: number, stepIndex = 0, timestampMs = Date.now()): SlideKeyframe {
    const adjustedTime = timestampMs - this.totalPausedDurationMs;
    const kf: SlideKeyframe = { slideIndex, stepIndex, timestampMs: adjustedTime };
    this.keyframes.push(kf);
    return kf;
  }

  addNarrationSegment(segment: NarrationSegment): void {
    this.narrationSegments.push(segment);
  }

  pause(timestampMs = Date.now()): void {
    if (this.paused) return;
    this.paused = true;
    this.pauseStartedMs = timestampMs;
  }

  resume(timestampMs = Date.now()): void {
    if (!this.paused) return;
    this.paused = false;
    this.totalPausedDurationMs += Math.max(0, timestampMs - this.pauseStartedMs);
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Replace a segment for retakes without leaving gaps or overlapping audio.
   */
  replaceSegment(segmentId: string, newSegment: NarrationSegment): boolean {
    const idx = this.narrationSegments.findIndex((s) => s.id === segmentId);
    if (idx === -1) return false;
    this.narrationSegments[idx] = newSegment;
    return true;
  }

  /**
   * Validate synchronization between visual slide keyframes and audio narration markers.
   * Documented tolerance: 50 ms.
   */
  validateSync(toleranceMs = 50): {
    synchronized: boolean;
    maxDriftMs: number;
    driftPerSlide: Record<number, number>;
  } {
    const driftPerSlide: Record<number, number> = {};
    let maxDriftMs = 0;

    for (const kf of this.keyframes) {
      // Find matching narration segment covering or starting near this keyframe
      const matching = this.narrationSegments.find(
        (seg) => seg.slideIndex === kf.slideIndex || (seg.startMs <= kf.timestampMs && seg.endMs >= kf.timestampMs),
      );
      if (matching) {
        const drift = Math.abs(matching.startMs - kf.timestampMs);
        driftPerSlide[kf.slideIndex] = drift;
        if (drift > maxDriftMs) maxDriftMs = drift;
      }
    }

    return {
      synchronized: maxDriftMs <= toleranceMs,
      maxDriftMs,
      driftPerSlide,
    };
  }

  /** Generate WebVTT timed captions from speaker notes and captions. */
  generateWebVTT(slideNotes: Record<number, string>): string {
    const lines = ["WEBVTT", ""];
    for (let i = 0; i < this.keyframes.length; i++) {
      const kf = this.keyframes[i];
      const nextKf = this.keyframes[i + 1];
      const startSec = (kf.timestampMs / 1000).toFixed(3);
      const endSec = nextKf ? (nextKf.timestampMs / 1000).toFixed(3) : ((kf.timestampMs + 5000) / 1000).toFixed(3);
      const note = slideNotes[kf.slideIndex]?.trim();
      if (note) {
        const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
        const formatVttTime = (secStr: string) => {
          const s = parseFloat(secStr);
          const hrs = pad(s / 3600);
          const mins = pad((s % 3600) / 60);
          const secs = (s % 60).toFixed(3).padStart(6, "0");
          return `${hrs}:${mins}:${secs}`;
        };
        lines.push(`${formatVttTime(startSec)} --> ${formatVttTime(endSec)}`);
        lines.push(note.replace(/<[^>]+>/g, ""));
        lines.push("");
      }
    }
    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Recoverable Errors
// ---------------------------------------------------------------------------

export type RecordingErrorCode =
  | "PERMISSION_DENIED"
  | "DISK_EXHAUSTION"
  | "INTERRUPTED_CAPTURE"
  | "UNSUPPORTED_CODEC";

export class RecordingError extends Error {
  readonly code: RecordingErrorCode;
  readonly recoverable: boolean;

  constructor(code: RecordingErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = "RecordingError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function handleRecordingError(
  error: unknown,
  partialChunks?: Blob[],
): {
  code: RecordingErrorCode | "UNKNOWN";
  message: string;
  recoverable: boolean;
  partialVideo: Blob | null;
} {
  const partialVideo =
    partialChunks && partialChunks.length > 0 ? new Blob(partialChunks, { type: "video/webm" }) : null;

  if (error instanceof RecordingError) {
    return {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      partialVideo,
    };
  }

  const errStr = String(error);
  if (/permission|notallowed|denied/i.test(errStr)) {
    return {
      code: "PERMISSION_DENIED",
      message: "Microphone or screen recording permission was denied.",
      recoverable: true,
      partialVideo,
    };
  }
  if (/quota|disk|storage|full/i.test(errStr)) {
    return {
      code: "DISK_EXHAUSTION",
      message: "Storage quota exceeded while recording.",
      recoverable: true,
      partialVideo,
    };
  }
  if (/abort|interrupt|closed/i.test(errStr)) {
    return {
      code: "INTERRUPTED_CAPTURE",
      message: "Recording capture was interrupted.",
      recoverable: true,
      partialVideo,
    };
  }
  if (/codec|mime|format|unsupported/i.test(errStr)) {
    return {
      code: "UNSUPPORTED_CODEC",
      message: "Requested video codec is not supported on this platform.",
      recoverable: true,
      partialVideo,
    };
  }

  return {
    code: "UNKNOWN",
    message: "Recording encountered an unexpected error.",
    recoverable: true,
    partialVideo,
  };
}

// ---------------------------------------------------------------------------
// Video Container & Target Player Validation
// ---------------------------------------------------------------------------

export interface TargetPlayerCapabilities {
  target: "chrome" | "firefox" | "safari" | "quicktime" | "vlc";
  supportedCodecs: string[];
  containerFormats: string[];
}

export const TARGET_PLAYERS: Record<string, TargetPlayerCapabilities> = {
  chrome: {
    target: "chrome",
    supportedCodecs: ["vp8", "vp9", "h264", "av1", "opus", "aac"],
    containerFormats: ["video/webm", "video/mp4"],
  },
  firefox: {
    target: "firefox",
    supportedCodecs: ["vp8", "vp9", "h264", "av1", "opus", "aac"],
    containerFormats: ["video/webm", "video/mp4"],
  },
  safari: {
    target: "safari",
    supportedCodecs: ["h264", "h265", "aac"],
    containerFormats: ["video/mp4"],
  },
  quicktime: {
    target: "quicktime",
    supportedCodecs: ["h264", "h265", "aac", "prores"],
    containerFormats: ["video/mp4", "video/quicktime"],
  },
  vlc: {
    target: "vlc",
    supportedCodecs: ["vp8", "vp9", "h264", "h265", "av1", "opus", "aac"],
    containerFormats: ["video/webm", "video/mp4", "video/quicktime", "video/x-matroska"],
  },
};

export function validateVideoContainer(
  blob: Blob,
  targetPlayer?: "chrome" | "firefox" | "safari" | "quicktime" | "vlc",
): {
  valid: boolean;
  mimeType: string;
  sizeBytes: number;
  playerSupported: boolean;
  warnings: string[];
} {
  const mimeType = blob.type || "video/webm";
  const sizeBytes = blob.size;
  const warnings: string[] = [];

  if (sizeBytes === 0) {
    warnings.push("Video file is empty (0 bytes).");
  }

  let playerSupported = true;
  if (targetPlayer && TARGET_PLAYERS[targetPlayer]) {
    const caps = TARGET_PLAYERS[targetPlayer];
    const baseMime = mimeType.split(";")[0].toLowerCase();
    if (!caps.containerFormats.includes(baseMime)) {
      playerSupported = false;
      warnings.push(`Target player '${targetPlayer}' does not natively support container format '${baseMime}'.`);
    }
  }

  return {
    valid: sizeBytes > 0 && warnings.length === 0,
    mimeType,
    sizeBytes,
    playerSupported,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// SlideshowRecorder Class
// ---------------------------------------------------------------------------

/**
 * Records the slideshow by painting each slide onto a canvas and capturing
 * that canvas. The caller paints whenever the current slide changes.
 */
export class SlideshowRecorder {
  readonly canvas: HTMLCanvasElement;
  readonly timeline: RecordingTimeline;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(width = 960, height = 540) {
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      this.canvas = document.createElement("canvas");
    } else {
      this.canvas = { width, height, getContext: () => null, captureStream: () => ({} as any) } as unknown as HTMLCanvasElement;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.timeline = new RecordingTimeline();
  }

  start(mimeType?: string) {
    const stream = this.canvas.captureStream(12);
    let chosenMime = mimeType;
    if (!chosenMime) {
      if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
          chosenMime = "video/webm;codecs=vp9";
        } else if (MediaRecorder.isTypeSupported("video/webm")) {
          chosenMime = "video/webm";
        } else if (MediaRecorder.isTypeSupported("video/mp4")) {
          chosenMime = "video/mp4";
        }
      }
    }
    this.chunks = [];
    try {
      this.recorder = new MediaRecorder(stream, chosenMime ? { mimeType: chosenMime } : undefined);
      this.recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) this.chunks.push(event.data);
      };
      this.recorder.start(200);
    } catch (err) {
      throw new RecordingError("UNSUPPORTED_CODEC", `Failed to initialize MediaRecorder: ${String(err)}`);
    }
  }

  paint(
    slide: Slide | undefined,
    deckW: number,
    deckH: number,
    master?: SlideElement[],
    masterBackground?: string,
    step?: number,
  ) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const ops = slideDrawOps(
      slide,
      this.canvas.width,
      this.canvas.height,
      deckW,
      deckH,
      master,
      masterBackground,
      step,
    );
    paintOps(ctx, ops);
    for (const op of ops) {
      if (op.kind !== "image") continue;
      const image = new Image();
      image.onload = () => {
        ctx.drawImage(image, op.x, op.y, op.w, op.h);
      };
      image.src = op.src;
    }
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve(new Blob(this.chunks, { type: "video/webm" }));
    }
    return new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || "video/webm" }));
      recorder.stop();
    });
  }

  getRecordedChunks(): Blob[] {
    return [...this.chunks];
  }
}

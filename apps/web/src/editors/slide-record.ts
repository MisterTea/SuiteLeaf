import type { Slide, SlideElement } from "@suiteleaf/core";

export type DrawOp =
  | { kind: "fill"; color: string }
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { kind: "text"; text: string; x: number; y: number; size: number; color: string }
  | { kind: "image"; src: string; x: number; y: number; w: number; h: number };

function box(el: SlideElement, width: number, height: number, deckW: number, deckH: number) {
  return {
    x: (el.x / deckW) * width,
    y: (el.y / deckH) * height,
    w: (el.width / deckW) * width,
    h: (el.height / deckH) * height,
  };
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
): DrawOp[] {
  const ops: DrawOp[] = [
    {
      kind: "fill",
      color: slide?.background?.color || masterBackground || "#ffffff",
    },
  ];
  const paint = (el: SlideElement) => {
    const place = box(el, width, height, deckW, deckH);
    if (el.type === "shape") {
      ops.push({ kind: "rect", ...place, color: el.fill || "#e2e8f0" });
    }
    if (el.type === "image" && el.src) {
      ops.push({ kind: "image", src: el.src, ...place });
    }
    const text = el.content?.trim();
    if (text) {
      ops.push({
        kind: "text",
        text,
        x: place.x + 4,
        y: place.y + Math.min(place.h - 4, (el.fontSize || 18) + 4),
        size: ((el.fontSize || 18) / deckH) * height,
        color: el.color || "#1e293b",
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
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.kind === "text") {
      ctx.fillStyle = op.color;
      ctx.font = `${Math.max(10, op.size)}px Arial`;
      ctx.textBaseline = "bottom";
      ctx.fillText(op.text, op.x, op.y);
    }
  }
}

/**
 * Records the slideshow by painting each slide onto a canvas and capturing
 * that canvas. The caller paints whenever the current slide changes.
 */
export class SlideshowRecorder {
  readonly canvas: HTMLCanvasElement;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(width = 960, height = 540) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
  }

  start() {
    const stream = this.canvas.captureStream(12);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.recorder.start(200);
  }

  paint(
    slide: Slide | undefined,
    deckW: number,
    deckH: number,
    master?: SlideElement[],
    masterBackground?: string,
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
}

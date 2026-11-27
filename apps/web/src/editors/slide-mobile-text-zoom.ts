import { useLayoutEffect, type RefObject } from "react";
import type { Slide } from "@suiteleaf/core";

/**
 * Keep `--canvas-fit` synced with the rendered canvas width in JS so slide text
 * scales properly on browsers without `atan2(<length>, <length>)` (e.g. Chrome <= 133).
 */
export function useSlideCanvasFit(
  stageRef: RefObject<HTMLDivElement | null>,
  deckWidth: number,
) {
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const designWidth = Math.max(1, deckWidth || 960);
    const sync = () => {
      const canvas = stage.querySelector<HTMLElement>(".slide-canvas");
      const fit = canvas?.querySelector<HTMLElement>(".slide-canvas-fit");
      if (!canvas || !fit) return;
      const width = canvas.clientWidth;
      if (width > 0) fit.style.setProperty("--canvas-fit", String(width / designWidth));
    };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    const canvas = stage.querySelector<HTMLElement>(".slide-canvas");
    if (canvas) observer?.observe(canvas);
    observer?.observe(stage);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [stageRef, deckWidth]);
}

/** Enlarge the canvas itself so text metrics and pointer coordinates stay in sync. */
export function useSlideMobileTextZoom(
  stageRef: RefObject<HTMLDivElement | null>,
  slide: Slide | undefined,
  focusedBox: string | null,
  deckWidth: number,
  readOnly: boolean,
) {
  const element = slide?.elements.find((box) => box.id === focusedBox);
  const { id, type, x = 0, y = 0, width: boxWidth = 0, height: boxHeight = 0 } = element ?? {};
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const canvas = stage?.querySelector<HTMLElement>(".slide-canvas");
    if (!stage || !canvas || !id || type !== "text" || readOnly) return;
    const savedStyle = canvas.getAttribute("style");
    const scrollLeft = stage.scrollLeft;
    const scrollTop = stage.scrollTop;
    const baseWidth = canvas.getBoundingClientRect().width || stage.clientWidth;

    const fit = () => {
      if (window.innerWidth > 700 || !stage.clientWidth) return;
      const normalWidth = baseWidth;
      if (!normalWidth) return;
      const available = Math.max(1, stage.clientWidth - 32);
      const width = Math.max(normalWidth, Math.min(normalWidth * 3, (available * deckWidth) / Math.max(1, boxWidth)));

      canvas.style.transition = "width 0.22s cubic-bezier(0.16, 1, 0.3, 1), margin 0.22s cubic-bezier(0.16, 1, 0.3, 1)";
      canvas.style.width = `${width}px`;
      canvas.style.maxWidth = "none";
      canvas.style.alignSelf = "flex-start";
      canvas.style.margin = "0";

      const scale = width / deckWidth;
      const fitLayer = canvas.querySelector<HTMLElement>(".slide-canvas-fit");
      if (fitLayer) fitLayer.style.setProperty("--canvas-fit", String(scale));
      const targetScrollLeft = Math.max(0, (x + boxWidth / 2) * scale - stage.clientWidth / 2);
      const targetScrollTop = Math.max(0, y * scale - Math.max(16, (stage.clientHeight - boxHeight * scale) / 2));

      if (typeof stage.scrollTo === "function") {
        stage.scrollTo({ left: targetScrollLeft, top: targetScrollTop, behavior: "smooth" });
      } else {
        stage.scrollLeft = targetScrollLeft;
        stage.scrollTop = targetScrollTop;
      }
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(stage);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      if (savedStyle === null) canvas.removeAttribute("style");
      else canvas.setAttribute("style", savedStyle);
      if (typeof stage.scrollTo === "function") {
        stage.scrollTo({ left: scrollLeft, top: scrollTop, behavior: "smooth" });
      } else {
        stage.scrollLeft = scrollLeft;
        stage.scrollTop = scrollTop;
      }
    };
  }, [stageRef, slide?.id, id, type, x, y, boxWidth, boxHeight, deckWidth, readOnly]);
}

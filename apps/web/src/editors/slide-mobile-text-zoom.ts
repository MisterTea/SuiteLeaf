import { useLayoutEffect, type RefObject } from "react";
import type { Slide } from "@suiteleaf/core";

/** Enlarge the canvas itself so text metrics and pointer coordinates stay in sync. */
export function useSlideMobileTextZoom(
  stageRef: RefObject<HTMLDivElement | null>,
  slide: Slide,
  focusedBox: string | null,
  deckWidth: number,
  readOnly: boolean,
) {
  const element = slide.elements.find((box) => box.id === focusedBox);
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
      const available = Math.max(1, stage.clientWidth - 24);

      // Provide a comfortable reading zoom (at least ~1.55x) while scaling narrow boxes to fill the width.
      const minComfortableZoom = normalWidth * 1.55;
      const maxZoom = normalWidth * 2.2;
      const fitBoxWidth = (available * deckWidth) / Math.max(1, boxWidth);
      const width = Math.round(Math.min(maxZoom, Math.max(minComfortableZoom, fitBoxWidth)));

      canvas.style.transition = "width 0.22s cubic-bezier(0.16, 1, 0.3, 1), margin 0.22s cubic-bezier(0.16, 1, 0.3, 1)";
      canvas.style.width = `${width}px`;
      canvas.style.maxWidth = "none";
      canvas.style.alignSelf = "flex-start";
      canvas.style.margin = "0";

      const scale = width / deckWidth;
      const boxLeftInCanvas = x * scale;
      const boxWidthInCanvas = boxWidth * scale;
      const offsetLeft = canvas.offsetLeft;
      const boxLeftInStage = offsetLeft + boxLeftInCanvas;

      // If the box fits within the available width, center it; otherwise align its left edge with padding.
      const targetScrollLeft = boxWidthInCanvas <= available
        ? Math.max(0, Math.round(boxLeftInStage + boxWidthInCanvas / 2 - stage.clientWidth / 2))
        : Math.max(0, Math.round(boxLeftInStage - 14));

      // Keep the top of the box in the upper field of view above the software keyboard.
      const offsetTop = canvas.offsetTop;
      const boxTopInStage = offsetTop + y * scale;
      const targetScrollTop = Math.max(0, Math.round(boxTopInStage - 20));

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
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
      if (savedStyle === null) canvas.removeAttribute("style");
      else canvas.setAttribute("style", savedStyle);
      if (typeof stage.scrollTo === "function") {
        stage.scrollTo({ left: scrollLeft, top: scrollTop, behavior: "smooth" });
      } else {
        stage.scrollLeft = scrollLeft;
        stage.scrollTop = scrollTop;
      }
    };
  }, [stageRef, slide.id, id, type, x, y, boxWidth, boxHeight, deckWidth, readOnly]);
}

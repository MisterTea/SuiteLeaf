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
    const restore = () => {
      if (savedStyle === null) canvas.removeAttribute("style");
      else canvas.setAttribute("style", savedStyle);
      stage.scrollLeft = scrollLeft;
      stage.scrollTop = scrollTop;
    };
    const fit = () => {
      restore();
      if (window.innerWidth > 700 || !stage.clientWidth) return;
      const available = Math.max(1, stage.clientWidth - 32);
      const normalWidth = canvas.getBoundingClientRect().width;
      if (!normalWidth) return;
      // Fit the box across the phone, with a cap for very narrow boxes.
      const width = Math.max(normalWidth, Math.min(normalWidth * 3, available * deckWidth / Math.max(1, boxWidth)));
      canvas.style.width = `${width}px`;
      canvas.style.maxWidth = "none";
      canvas.style.alignSelf = "flex-start";
      canvas.style.margin = "0";
      const rect = canvas.getBoundingClientRect();
      const viewport = stage.getBoundingClientRect();
      const scale = rect.width / deckWidth;
      stage.scrollLeft += rect.left - viewport.left + (x + boxWidth / 2) * scale - stage.clientWidth / 2;
      // Keep the beginning of a tall box visible above the software keyboard.
      stage.scrollTop += rect.top - viewport.top + y * scale - Math.max(16, (stage.clientHeight - boxHeight * scale) / 2);
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(stage);
    window.addEventListener("resize", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
      restore();
    };
  }, [stageRef, slide.id, id, type, x, y, boxWidth, boxHeight, deckWidth, readOnly]);
}

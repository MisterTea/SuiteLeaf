import { useLayoutEffect, useRef } from "react";

/** Mobile keyboards resize/pan the visual viewport, not necessarily 100dvh. */
export function useWorkspaceViewport() {
  const ref = useRef<HTMLDivElement>(null);
  const baselineRef = useRef({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    const viewport = window.visualViewport;
    if (!node || !viewport) return;
    const root = document.documentElement;
    const update = () => {
      const h = `${viewport.height}px`;
      const t = `${viewport.offsetTop}px`;
      node.style.setProperty("--workspace-visible-height", h);
      node.style.setProperty("--workspace-visible-top", t);
      root.style.setProperty("--workspace-visible-height", h);
      root.style.setProperty("--workspace-visible-top", t);
      if (baselineRef.current.width !== window.innerWidth) {
        baselineRef.current = { width: window.innerWidth, height: Math.max(window.innerHeight, viewport.height) };
      } else {
        baselineRef.current.height = Math.max(baselineRef.current.height, window.innerHeight, viewport.height);
      }
      const keyboardOpen = window.innerWidth <= 700 && baselineRef.current.height - viewport.height > 120;
      if (keyboardOpen) {
        node.dataset.keyboardOpen = "true";
        root.dataset.keyboardOpen = "true";
      } else {
        delete node.dataset.keyboardOpen;
        delete root.dataset.keyboardOpen;
      }
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--workspace-visible-height");
      root.style.removeProperty("--workspace-visible-top");
      delete root.dataset.keyboardOpen;
    };
  });
  return ref;
}

import { useLayoutEffect, useRef } from "react";

/** Mobile keyboards resize/pan the visual viewport, not necessarily 100dvh. */
export function useWorkspaceViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    const viewport = window.visualViewport;
    if (!node || !viewport) return;
    const update = () => {
      node.style.setProperty("--workspace-visible-height", `${viewport.height}px`);
      node.style.setProperty("--workspace-visible-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  });
  return ref;
}

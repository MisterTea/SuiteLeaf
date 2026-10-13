import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * Folds toolbar controls that do not fit into a "More tools" row, like the
 * Google Sheets toolbar. Controls stay in the toolbar's DOM (so their React
 * state and handlers are untouched); hidden ones are marked `data-overflow`
 * and shown as a floating second row while the More button is open.
 *
 * Controls matching `pinned` fold last; the rest fold from the right.
 * The toolbar needs a `.more-tools` button and, while open, a `.toolbar-break`.
 */
export function useToolbarOverflow(
  ref: RefObject<HTMLElement | null>,
  pinned: string,
) {
  const [overflowing, setOverflowing] = useState(false),
    [open, setOpen] = useState(false);

  const fit = () => {
    const bar = ref.current;
    if (!bar) return;
    const more = bar.querySelector<HTMLElement>(":scope > .more-tools");
    const tools = [...bar.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        el !== more &&
        !el.classList.contains("toolbar-break"),
    );
    bar.dataset.measuring = "";
    tools.forEach((t) => delete t.dataset.overflow);
    const box = bar.getBoundingClientRect(),
      style = getComputedStyle(bar),
      end = box.right - parseFloat(style.paddingRight) - 1,
      gap = parseFloat(style.columnGap) || 0;
    const visible = () => tools.filter((t) => t.dataset.overflow === undefined);
    const right = () =>
      Math.max(...visible().map((t) => t.getBoundingClientRect().right), 0);
    let hidden = 0;
    if (right() > end) {
      const limit = end - (more?.offsetWidth ?? 0) - gap;
      const order = [
        ...tools.filter((t) => !t.matches(pinned)).reverse(),
        ...tools.filter((t) => t.matches(pinned)).reverse(),
      ];
      for (const t of order) {
        if (right() <= limit) break;
        t.dataset.overflow = "";
        hidden++;
      }
      // Drop dividers left dangling at either end or next to each other.
      let previous: HTMLElement | undefined;
      for (const t of visible()) {
        const divider = t.classList.contains("toolbar-divider");
        if (
          divider &&
          (!previous || previous.classList.contains("toolbar-divider"))
        )
          t.dataset.overflow = "";
        else previous = t;
      }
      if (previous?.classList.contains("toolbar-divider"))
        previous.dataset.overflow = "";
      const first = tools.find(
        (t) =>
          t.dataset.overflow !== undefined &&
          !t.classList.contains("toolbar-divider"),
      );
      if (first) first.dataset.overflow = "first";
    }
    delete bar.dataset.measuring;
    if (bar.classList.contains("show-more")) {
      const rects = tools
        .filter((t) => t.dataset.overflow !== undefined)
        .map((t) => t.getBoundingClientRect())
        .filter((r) => r.width > 0);
      if (rects.length) {
        const left = Math.min(...rects.map((r) => r.left)),
          top = Math.min(...rects.map((r) => r.top));
        bar.style.setProperty("--more-left", `${left - box.left}px`);
        bar.style.setProperty("--more-top", `${top - box.top}px`);
        bar.style.setProperty(
          "--more-width",
          `${Math.max(...rects.map((r) => r.right)) - left}px`,
        );
        bar.style.setProperty(
          "--more-height",
          `${Math.max(...rects.map((r) => r.bottom)) - top}px`,
        );
      }
    }
    setOverflowing(hidden > 0);
    if (!hidden) setOpen(false);
  };

  // Control widths change with state (labels, counts), so refit after every render.
  useLayoutEffect(fit);

  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(bar);
    void document.fonts?.ready.then(() => fit());
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !ref.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close);
    };
  }, [open, ref]);

  return { overflowing, open, setOpen };
}

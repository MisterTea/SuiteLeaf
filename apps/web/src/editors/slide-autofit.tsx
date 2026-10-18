import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
} from "react";

/** Fitted type stays readable. Smaller than this, the overflow is left as it is. */
export const AUTOFIT_MIN_PX = 8;

/**
 * Largest size at or below `normalPx` for which `fits` is true.
 * Never goes below 8px. A normal size that is already under 8px is left alone.
 */
export function autofitFontSize(
  fits: (px: number) => boolean,
  normalPx: number,
  minPx = AUTOFIT_MIN_PX,
): number {
  if (!(normalPx > 0) || fits(normalPx) || normalPx <= minPx) return normalPx;
  if (!fits(minPx)) return minPx;
  let lo = minPx;
  let hi = normalPx;
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Changes that can make the same box need a different fitted size. */
export function autofitSignature(el: {
  content?: string;
  runs?: unknown;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  width: number;
  height: number;
  align?: string;
}): string {
  return JSON.stringify([
    el.content ?? "",
    el.runs ?? null,
    el.fontSize ?? null,
    el.fontFamily ?? "",
    !!el.bold,
    !!el.italic,
    el.width,
    el.height,
    el.align ?? "",
  ]);
}

function textNode(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>("textarea, .element-editor") ?? root;
}

/** Editor sizes are already pixels. A slideshow size scales with the slide. */
function naturalPx(root: HTMLElement, normalPx: number, fitTo?: number) {
  if (!fitTo) return normalPx;
  const slide = root.closest(".show-slide");
  const width = slide instanceof HTMLElement ? slide.clientWidth : 0;
  if (width <= 0) return 0;
  return (normalPx / fitTo) * width;
}

/**
 * The box keeps its size. When autofit is on, the type shrinks until the words
 * fit, and stops at 8px if they still do not.
 */
export function AutofitBox({
  autofit,
  normalPx,
  fitTo,
  signature,
  style,
  children,
  ...rest
}: {
  autofit: boolean;
  normalPx: number;
  /** Deck width. Set on the slideshow, where the natural size scales with the slide. */
  fitTo?: number;
  signature: string;
  style?: CSSProperties;
} & Omit<ComponentPropsWithoutRef<"div">, "style">) {
  const ref = useRef<HTMLDivElement>(null);
  const [override, setOverride] = useState<number | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !autofit) {
      setOverride(null);
      return;
    }
    const measure = () => {
      const natural = naturalPx(root, normalPx, fitTo);
      const node = textNode(root);
      if (natural <= 0 || node.clientWidth <= 0 || node.clientHeight <= 0) return;
      const previous = node.style.fontSize;
      const fits = (px: number) => {
        node.style.fontSize = `${px}px`;
        return node.scrollHeight <= node.clientHeight + 1;
      };
      const next = autofitFontSize(fits, natural);
      node.style.fontSize = previous;
      const value = natural - next < 0.05 ? null : Math.floor(next * 100) / 100;
      setOverride((current) => {
        if (value == null) return current == null ? current : null;
        if (current != null && Math.abs(current - value) < 0.005) return current;
        return value;
      });
    };
    measure();
    const watch =
      (fitTo ? root.closest(".show-slide") : root.closest(".slide-canvas")) ??
      root;
    if (!(watch instanceof HTMLElement)) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(watch);
    return () => observer.disconnect();
  }, [autofit, normalPx, fitTo, signature]);

  const fontSize =
    autofit && override != null ? `${override}px` : style?.fontSize;
  return (
    <div ref={ref} {...rest} style={{ ...style, fontSize }}>
      {children}
    </div>
  );
}

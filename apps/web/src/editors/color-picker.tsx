import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./color-picker.css";

type Rgb = { r: number; g: number; b: number };
type Hsv = { h: number; s: number; v: number };

export function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function byte(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function rgbToHex({ r, g, b }: Rgb) {
  const channel = (n: number) => byte(n).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: byte((r + m) * 255), g: byte((g + m) * 255), b: byte((b + m) * 255) };
}

export function hsvToHex(hsv: Hsv) {
  return rgbToHex(hsvToRgb(hsv));
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function drag(
  event: ReactPointerEvent<HTMLElement>,
  read: (el: HTMLElement, x: number, y: number) => void,
  commit: () => void,
) {
  const el = event.currentTarget;
  event.preventDefault();
  el.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    read(el, e.clientX, e.clientY);
  };
  const finish = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", finish);
    el.removeEventListener("pointercancel", cancel);
    read(el, e.clientX, e.clientY);
    commit();
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", finish);
    el.removeEventListener("pointercancel", cancel);
  };
  read(el, event.clientX, event.clientY);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", cancel);
}

/** Toolbar color control. Dragging updates the shown color; release applies it. */
export function ColorTool({
  label,
  value,
  onCommit,
  children,
  disabled = false,
  swatch = false,
}: {
  label: string;
  value: string;
  onCommit: (hex: string) => void;
  children?: ReactNode;
  disabled?: boolean;
  swatch?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const live = useRef<Hsv>({ h: 0, s: 0, v: 0 });
  const valueRef = useRef(value);
  valueRef.current = value;
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>({ h: 0, s: 0, v: 0 });
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const shown = open ? hsvToHex(hsv) : value;
  const rgb = hsvToRgb(hsv);

  const preview = (next: Hsv) => {
    live.current = next;
    setHsv(next);
  };
  const commit = () => onCommit(hsvToHex(live.current));

  const openPicker = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const parsed = parseHex(valueRef.current) ?? { r: 0, g: 0, b: 0 };
    preview(rgbToHsv(parsed));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = root.current?.querySelector("button");
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = 216;
      setAnchor({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || popover.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className={`color-tool${swatch ? " swatch" : ""}`} ref={root}>
      <button
        type="button"
        className="color-tool-btn"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openPicker}
      >
        {swatch ? (
          <span className="color-swatch" style={{ backgroundColor: shown }} />
        ) : (
          <span className="color-icon-wrapper">
            {children}
            <span className="color-bar" style={{ backgroundColor: shown }} />
          </span>
        )}
      </button>
      {open
        ? createPortal(
        <div
          ref={popover}
          className="color-popover"
          role="dialog"
          aria-label={label}
          style={{ top: anchor.top, left: anchor.left }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <div
            className="color-field"
            role="application"
            aria-label="Saturation and brightness"
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
            onPointerDown={(event) =>
              drag(
                event,
                (el, x, y) => {
                  const box = el.getBoundingClientRect();
                  preview({
                    ...live.current,
                    s: clamp01((x - box.left) / box.width),
                    v: clamp01(1 - (y - box.top) / box.height),
                  });
                },
                commit,
              )
            }
          >
            <span
              className="color-field-thumb"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                backgroundColor: shown,
              }}
            />
          </div>
          <div className="color-hue-row">
            <span className="color-preview" style={{ backgroundColor: shown }} />
            <div
              className="color-hue"
              role="slider"
              aria-label="Hue"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)}
              aria-valuetext={shown}
              onPointerDown={(event) =>
                drag(
                  event,
                  (el, x) => {
                    const box = el.getBoundingClientRect();
                    preview({
                      ...live.current,
                      h: clamp01((x - box.left) / box.width) * 360,
                    });
                  },
                  commit,
                )
              }
            >
              <span className="color-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
            </div>
          </div>
          <div className="color-rgb">
            {(
              [
                ["Red", "R", rgb.r],
                ["Green", "G", rgb.g],
                ["Blue", "B", rgb.b],
              ] as const
            ).map(([name, short, channel]) => (
              <label key={name}>
                <input
                  aria-label={name}
                  type="number"
                  min={0}
                  max={255}
                  value={channel}
                  onChange={(event) => {
                    const next = byte(Number(event.target.value));
                    const color = hsvToRgb(live.current);
                    color[short.toLowerCase() as "r" | "g" | "b"] = next;
                    preview(rgbToHsv(color));
                  }}
                  onBlur={commit}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    commit();
                  }}
                />
                <span>{short}</span>
              </label>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

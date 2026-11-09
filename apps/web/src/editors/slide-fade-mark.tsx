import { Sparkles } from "lucide-react";
import { fadesOnClick } from "./slide-fade-in";
import "./slide-fade-in.css";

/** The mark on an object that waits for the next slideshow click. */
export function FadeOnClickMark({
  element,
  sequence,
}: {
  element: { animation?: string; animationOrder?: number };
  sequence?: number;
}) {
  if (!fadesOnClick(element)) return null;
  const seq = sequence ?? element.animationOrder ?? 1;
  return (
    <span
      className="fade-on-click-mark"
      aria-label={`Animation ${seq}`}
      title={`Animation ${seq}`}
    >
      <Sparkles size={12} className="fade-on-click-icon" aria-hidden="true" />
      <span>{seq}</span>
    </span>
  );
}

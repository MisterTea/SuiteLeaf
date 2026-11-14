import type { ParagraphBuild, ExitBuild } from "@suiteleaf/core/slide-motion";
import { Sparkles } from "lucide-react";
import { fadesOnClick } from "./slide-fade-in";
import "./slide-fade-in.css";

/** The effect numbers on an animated object, including paragraph builds and exits. */
export function FadeOnClickMark({
  element,
  sequence,
}: {
  element: {
    animation?: string;
    animationOrder?: number;
    paragraphBuilds?: readonly ParagraphBuild[];
    animationExit?: ExitBuild;
  };
  sequence?: number | readonly number[];
}) {
  if (!fadesOnClick(element) && !element.paragraphBuilds?.length && !element.animationExit)
    return null;
  const fallback = element.animationOrder ?? element.paragraphBuilds?.[0]?.order ??
    element.animationExit?.order ?? 1;
  const numbers = typeof sequence === "number" ? [sequence] : sequence ?? [fallback];
  const seq = numbers.join(", ");
  const label = `${numbers.length > 1 ? "Animations" : "Animation"} ${seq}`;
  return (
    <span
      className="fade-on-click-mark"
      aria-label={label}
      title={label}
    >
      <Sparkles size={12} className="fade-on-click-icon" aria-hidden="true" />
      <span>{seq}</span>
    </span>
  );
}

import { animationLabel, fadesOnClick } from "./slide-fade-in";
import "./slide-fade-in.css";

/** The mark on an object that waits for the next slideshow click. */
export function FadeOnClickMark({ element }: { element: { animation?: string } }) {
  if (!fadesOnClick(element)) return null;
  return <span className="fade-on-click-mark">{animationLabel(element.animation)}</span>;
}

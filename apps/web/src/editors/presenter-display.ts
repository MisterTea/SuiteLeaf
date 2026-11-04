import { inheritedText } from "./slide-master";

/** What the audience screen shows. Speaker notes are not on this object. */
export type AudienceFrame = {
  slideIndex: number;
  blank: boolean;
};

/** What the presenter screen shows, including notes and the next title. */
export type PresenterFrame = {
  slideIndex: number;
  notes: string;
  nextTitle: string | null;
  elapsedMs: number;
  ended: boolean;
};

export type ShowFrame = {
  audience: AudienceFrame;
  presenter: PresenterFrame;
};

/** The presenter's next-slide label. A blank heading uses the slide number. Notes are not an input. */
export function nextSlideTitle(index: number | null, heading: string | undefined): string | null {
  if (index === null || !Number.isInteger(index) || index < 0) return null;
  const text = heading?.replace(/\s+/g, " ").trim();
  if (text) return text;
  return `Slide ${index + 1}`;
}

/** The first text box, using master text when the box is blank. Notes are not an input. */
export function slideTitleText(
  elements: readonly { type?: string; wordArt?: boolean | string; id?: string; placeholder?: string; content?: string }[],
  master: readonly { id?: string; placeholder?: string; content?: string }[] = [],
): string | undefined {
  const masterText = master.map((item) => ({
    id: item.id ?? "",
    placeholder: item.placeholder,
    content: item.content,
  }));
  for (const element of elements) {
    if (element.type !== "text" || element.wordArt) continue;
    const content = inheritedText(
      { id: element.id ?? "", placeholder: element.placeholder, content: element.content },
      masterText,
    ).content
      ?.replace(/\s+/g, " ")
      .trim();
    if (content) return content.split("\n")[0];
  }
  return undefined;
}

/** Split one slideshow step into an audience frame and a presenter frame. */
export function showFrame(input: {
  slideIndex: number;
  slideCount: number;
  notes: string;
  nextTitle: string | null;
  elapsedMs: number;
  blank: boolean;
}): ShowFrame {
  const last = Math.max(0, input.slideCount - 1);
  const slideIndex = Math.min(Math.max(0, Math.floor(input.slideIndex)), last);
  const ended = input.slideCount === 0 || input.slideIndex >= last;
  return {
    audience: { slideIndex, blank: input.blank },
    presenter: {
      slideIndex,
      notes: input.notes,
      nextTitle: ended ? null : input.nextTitle,
      elapsedMs: Math.max(0, input.elapsedMs),
      ended,
    },
  };
}

/** The timer the presenter sees. While paused, the frozen time stays. */
/** Whole seconds before a slide advances on its own. Any other value does not advance. */
export function advanceAfterMs(seconds: unknown): number | null {
  if (!Number.isInteger(seconds) || (seconds as number) < 1 || (seconds as number) > 3600) return null;
  return (seconds as number) * 1000;
}

/** How long to wait before the next slide. A blank or paused show does not advance. */
export function showAdvanceDelay(input: {
  presenting: boolean;
  blank: boolean;
  paused: boolean;
  seconds: unknown;
}): number | null {
  if (!input.presenting || input.blank || input.paused) return null;
  return advanceAfterMs(input.seconds);
}

/** `m:ss`, or `h:mm:ss` after an hour. A time that is not a number is `0:00`. */
export function formatElapsed(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const secs = String(whole % 60).padStart(2, "0");
  const minutes = Math.floor(whole / 60) % 60;
  const hours = Math.floor(whole / 3600);
  const minuteText = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return hours > 0 ? `${hours}:${minuteText}:${secs}` : `${minuteText}:${secs}`;
}

export function shownElapsedMs(liveMs: number, paused: boolean, frozenMs: number): number {
  const live = Number.isFinite(liveMs) ? Math.max(0, Math.floor(liveMs)) : 0;
  const frozen = Number.isFinite(frozenMs) ? Math.max(0, Math.floor(frozenMs)) : 0;
  return paused ? frozen : live;
}

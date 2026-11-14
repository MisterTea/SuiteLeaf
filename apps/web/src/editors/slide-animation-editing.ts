import type { Presentation, Slide, SlideElement } from "@suiteleaf/core";
import {
  animationSequence,
  type OrderedAnimation,
  type AnimationTrigger,
} from "@suiteleaf/core/slide-motion";
import { animationEnterMs } from "./slide-fade-in";

export type AnimationEntry = OrderedAnimation & {
  key: string;
  label: string;
  ms: number;
  click: number;
};
const entryKey = (item: OrderedAnimation) =>
  `${item.id}:${item.exit ? "exit" : item.paragraphs ? `paragraph-${item.paragraphs.start}-${item.paragraphs.end}` : "entrance"}`;

/** Office indexes paragraphs, not visual wraps or soft line breaks. */
function animationText(
  element: SlideElement,
  range: OrderedAnimation["paragraphs"],
): string {
  if (!range)
    return (
      element.content?.trim() ||
      element.runs
        ?.map((run) => run.text)
        .join("")
        .trim() ||
      ""
    );
  let paragraphs: string[];
  if (element.runs?.length) {
    paragraphs = [""];
    for (const run of element.runs) {
      if (run.paragraphBreak && run.text === "\n") paragraphs.push("");
      else paragraphs[paragraphs.length - 1] += run.text;
    }
  } else paragraphs = (element.content ?? "").split(/\r\n|\r|\n/);
  return paragraphs
    .slice(range.start, range.end + 1)
    .join(" ")
    .trim();
}

export function animationEntries(slide: Slide | undefined): AnimationEntry[] {
  let click = 0;
  let lastOrder: number | undefined;
  return animationSequence(slide?.elements ?? []).map((item) => {
    if (
      lastOrder === undefined ||
      (item.order !== lastOrder && item.trigger === "click")
    ) {
      click++;
      lastOrder = item.order;
    }
    const el = slide!.elements[item.index];
    const pictureNumber = slide!.elements
      .slice(0, item.index + 1)
      .filter((element) => element.type === "image").length;
    const name =
      el.type === "image" && (!el.alt?.trim() || el.alt === "Slide image")
        ? `Picture ${pictureNumber}`
        : el.alt;
    const label = (
      animationText(el, item.paragraphs) ||
      el.placeholder ||
      name ||
      el.type
    ).replace(/\s+/g, " ");
    return {
      ...item,
      key: entryKey(item),
      label: `${label}${item.exit ? " (exit)" : item.paragraphs ? ` (paragraph ${item.paragraphs.start + 1})` : ""}`,
      ms: animationEnterMs(el.animationDuration),
      click,
    };
  });
}

export type AnimationGroup = AnimationEntry & { members: AnimationEntry[] };

/** Only coalesce painted layers of the same imported object and effect. */
export function animationGroups(slide: Slide | undefined): AnimationGroup[] {
  const groups: AnimationGroup[] = [];
  const bySourceEffect = new Map<string, AnimationGroup>();
  for (const entry of animationEntries(slide)) {
    const element = slide!.elements[entry.index];
    const source = element.sourceShapeId;
    const identity =
      source && !entry.paragraphs
        ? JSON.stringify([
            source,
            !!entry.exit,
            entry.kind,
            entry.order,
            entry.trigger,
            entry.ms,
          ])
        : undefined;
    const group = identity ? bySourceEffect.get(identity) : undefined;
    if (group) {
      group.members.push(entry);
      const representative = slide!.elements[group.index];
      // Name and select the content rather than its fill or outline.
      if (
        (element.type === "image" || element.type === "text") &&
        representative.type === "shape"
      )
        Object.assign(group, entry);
    } else {
      const next = { ...entry, members: [entry] };
      groups.push(next);
      if (identity) bySourceEffect.set(identity, next);
    }
  }
  return groups;
}

export function animationGroupContains(
  group: AnimationGroup,
  elementId: string | null | undefined,
): boolean {
  return group.members.some((member) => member.id === elementId);
}

function editEntry(
  el: SlideElement,
  entry: AnimationEntry,
  patch: { order?: number; trigger?: AnimationTrigger; remove?: boolean },
): SlideElement {
  if (entry.exit)
    return {
      ...el,
      animationExit: patch.remove
        ? undefined
        : {
            ...el.animationExit!,
            ...(patch.order !== undefined ? { order: patch.order } : {}),
            ...(patch.trigger ? { trigger: patch.trigger } : {}),
          },
    };
  if (entry.paragraphs)
    return {
      ...el,
      paragraphBuilds: el.paragraphBuilds?.flatMap((build) =>
        build.start === entry.paragraphs!.start &&
        build.end === entry.paragraphs!.end
          ? patch.remove
            ? []
            : [
                {
                  ...build,
                  ...(patch.order !== undefined ? { order: patch.order } : {}),
                  ...(patch.trigger ? { trigger: patch.trigger } : {}),
                },
              ]
          : [build],
      ),
    };
  return {
    ...el,
    ...(patch.remove
      ? {
          animation: undefined,
          animationOrder: undefined,
          animationTrigger: undefined,
          animationDuration: undefined,
        }
      : {
          ...(patch.order !== undefined ? { animationOrder: patch.order } : {}),
          ...(patch.trigger ? { animationTrigger: patch.trigger } : {}),
        }),
  };
}

export function changeAnimationEntry(
  deck: Presentation,
  slideId: string,
  key: string,
  patch: {
    trigger?: AnimationTrigger;
    duration?: number;
    remove?: boolean;
    move?: -1 | 1;
  },
): Presentation | null {
  const slide = deck.slides[slideId];
  const entries = animationGroups(slide);
  const index = entries.findIndex((entry) =>
    entry.members.some((member) => member.key === key),
  );
  if (
    !slide ||
    index < 0 ||
    (patch.duration !== undefined && !Number.isFinite(patch.duration))
  )
    return null;
  const entry = entries[index];
  let elements = slide.elements;
  if (patch.move) {
    const target = index + patch.move;
    if (target < 0 || target >= entries.length) return null;
    entries.splice(index, 1);
    entries.splice(target, 0, entry);
    elements = elements.map((el) =>
      entries.reduce(
        (next, item, at) =>
          item.members.reduce(
            (updated, member) =>
              member.id === el.id
                ? editEntry(updated, member, { order: at + 1 })
                : updated,
            next,
          ),
        el,
      ),
    );
  } else {
    elements = elements.map((el) => {
      const member = entry.members.find((item) => item.id === el.id);
      return member
        ? {
            ...editEntry(el, member, patch),
            ...(patch.duration !== undefined
              ? { animationDuration: animationEnterMs(patch.duration) }
              : {}),
          }
        : el;
    });
  }
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slideId]: { ...slide, timing: undefined, elements },
    },
  };
}

/** Preview advances click groups automatically while retaining with/after timing. */
export function animationPreviewTimeline<T extends AnimationEntry>(
  entries: T[],
): { entry: T; delay: number }[] {
  let groupEnd = 0;
  let groupStart = 0;
  let previousStart = 0;
  let previousEnd = 0;
  let click = 0;
  return entries.map((entry) => {
    if (entry.click !== click) {
      groupStart = click ? groupEnd + 250 : 0;
      click = entry.click;
    }
    const delay =
      entry.trigger === "after"
        ? Math.max(groupStart, previousEnd)
        : entry.trigger === "with"
          ? Math.max(groupStart, previousStart)
          : groupStart;
    previousStart = delay;
    previousEnd = delay + entry.ms;
    groupEnd = Math.max(groupEnd, previousEnd);
    return { entry, delay };
  });
}

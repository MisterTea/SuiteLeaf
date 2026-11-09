import JSZip from "jszip";
import type { Slide, SlideTransition } from "./index";

export const SLIDE_ANIMATIONS = [
  "fade-on-click",
  "appear-on-click",
  "fly-on-click",
  "wipe-on-click",
  "zoom-on-click",
] as const;

export type SlideAnimationKind = (typeof SLIDE_ANIMATIONS)[number];

export function isSlideAnimation(value: string | undefined): value is SlideAnimationKind {
  return (SLIDE_ANIMATIONS as readonly string[]).includes(value ?? "");
}

export type AnimationTrigger = "click" | "with" | "after";

export type OrderedAnimation = {
  id: string;
  index: number;
  kind: SlideAnimationKind;
  order: number;
  trigger: AnimationTrigger;
  /** Set when this click reveals paragraphs of a text box, not the whole box. */
  paragraphs?: { start: number; end: number };
  /** Set when this click hides the object. */
  exit?: boolean;
};

export type ParagraphBuild = {
  start: number;
  end: number;
  order: number;
  trigger?: AnimationTrigger;
};

export type ExitBuild = {
  order: number;
  trigger?: AnimationTrigger;
};

/**
 * Click animations in the order a preview and a PowerPoint file both use.
 * A missing order is the object's place on the slide, starting at 1.
 * The input list is not changed.
 */
export function animationSequence(
  elements: readonly {
    id: string;
    animation?: string;
    animationOrder?: number;
    animationTrigger?: string;
    paragraphBuilds?: readonly ParagraphBuild[];
    animationExit?: ExitBuild;
  }[],
): OrderedAnimation[] {
  return elements
    .flatMap((el, index) => {
      const trigger: AnimationTrigger =
        el.animationTrigger === "with" || el.animationTrigger === "after"
          ? el.animationTrigger
          : "click";
      const items: OrderedAnimation[] = [];
      if (isSlideAnimation(el.animation)) {
        items.push({
          id: el.id,
          index,
          kind: el.animation,
          order: el.animationOrder ?? index + 1,
          trigger,
        });
      }
      for (const build of el.paragraphBuilds ?? []) {
        items.push({
          id: el.id,
          index,
          kind: "appear-on-click",
          order: build.order,
          trigger: build.trigger === "with" || build.trigger === "after" ? build.trigger : "click",
          paragraphs: { start: build.start, end: build.end },
        });
      }
      if (el.animationExit) {
        const exitTrigger = el.animationExit.trigger;
        items.push({
          id: el.id,
          index,
          kind: "appear-on-click",
          order: el.animationExit.order,
          trigger: exitTrigger === "with" || exitTrigger === "after" ? exitTrigger : "click",
          exit: true,
        });
      }
      return items;
    })
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.index - b.index ||
        (a.paragraphs?.start ?? -1) - (b.paragraphs?.start ?? -1),
    );
}

/** One click per order. The same order, or a with/after trigger, stays on that click. */
export function animationClicks(
  elements: readonly {
    id: string;
    animation?: string;
    animationOrder?: number;
    animationTrigger?: string;
  }[],
): { ids: string[]; order: number }[] {
  const clicks: { ids: string[]; order: number }[] = [];
  for (const item of animationSequence(elements)) {
    const last = clicks.at(-1);
    const sameClick =
      !!last &&
      (last.order === item.order || item.trigger === "with" || item.trigger === "after");
    if (last && sameClick) last.ids.push(item.id);
    else clicks.push({ ids: [item.id], order: item.order });
  }
  return clicks;
}

export type ClickAnimation = {
  spid: string;
  kind: SlideAnimationKind;
  order: number;
  trigger?: AnimationTrigger;
  /** Paragraphs of a text box this click reveals. Absent when the whole shape appears. */
  paragraph?: { start: number; end: number };
  /** This click hides the shape instead of bringing it in. */
  exit?: boolean;
};

const FILTER: Record<SlideAnimationKind, string> = {
  "fade-on-click": "fade",
  "appear-on-click": "appear",
  "fly-on-click": "fly",
  "wipe-on-click": "wipe",
  "zoom-on-click": "zoom",
};

function kindFromFilter(filter: string, chunk: string): SlideAnimationKind {
  const name = filter.toLowerCase();
  if (name.startsWith("appear") || /<p:set\b/.test(chunk)) return "appear-on-click";
  if (name.startsWith("fly")) return "fly-on-click";
  if (name.startsWith("wipe") || name.startsWith("split") || name.startsWith("strips"))
    return "wipe-on-click";
  if (name.startsWith("zoom") || name.startsWith("grow") || name.startsWith("circle"))
    return "zoom-on-click";
  return "fade-on-click";
}

/** Click entrances in a PowerPoint timing tree, in the order they are clicked. */
export function readClickAnimations(xml: string): ClickAnimation[] {
  const timing = /<p:timing\b[\s\S]*?<\/p:timing>/.exec(xml)?.[0];
  if (!timing) return [];
  const out: ClickAnimation[] = [];
  let order = 0;
  let seenClick = false;
  for (const chunk of timing.split(/<p:par\b/)) {
    const spid = /<p:spTgt\b[^>]*\bspid="(\d+)"/.exec(chunk)?.[1];
    if (!spid) continue;
    const entrance =
      /nodeType="clickEffect"/.test(chunk) ||
      /nodeType="withEffect"/.test(chunk) ||
      /nodeType="afterEffect"/.test(chunk) ||
      /delay="indefinite"/.test(chunk) ||
      /transition="in"/.test(chunk);
    if (!entrance) continue;
    const filter = /filter="([^"]+)"/.exec(chunk)?.[1] ?? "";
    if (!filter && !/<p:set\b/.test(chunk) && !/<p:animEffect\b/.test(chunk)) continue;
    const withPrevious = /nodeType="withEffect"/.test(chunk);
    const afterPrevious = /nodeType="afterEffect"/.test(chunk);
    const range = /<p:pRg\b([^>]*)\/?>/.exec(chunk)?.[1] ?? "";
    const start = /(?:^|\s)st="(\d+)"/.exec(range)?.[1];
    const end = /(?:^|\s)end="(\d+)"/.exec(range)?.[1];
    const paragraph =
      start != null && end != null
        ? { start: Number(start), end: Number(end) }
        : undefined;
    const leaving =
      /presetClass="exit"/.test(chunk) || /<p:strVal\b[^>]*\bval="hidden"/.test(chunk);
    const identity = paragraph ? `${spid}:${paragraph.start}:${paragraph.end}` : leaving ? `${spid}:exit` : spid;
    if (out.some((item) => {
      const key = item.paragraph
        ? `${item.spid}:${item.paragraph.start}:${item.paragraph.end}`
        : item.exit
          ? `${item.spid}:exit`
          : item.spid;
      return key === identity;
    }))
      continue;
    if (!withPrevious && !afterPrevious) {
      order += 1;
      seenClick = true;
    }
    out.push({
      spid,
      kind: kindFromFilter(filter, chunk),
      order: seenClick ? order : 0,
      trigger: afterPrevious ? "after" : withPrevious ? "with" : "click",
      ...(paragraph ? { paragraph } : {}),
      ...(leaving ? { exit: true } : {}),
    });
  }
  return out;
}

/**
 * Nearest PowerPoint group first, for a shape drawn inside one or more groups.
 * The group's own id is not listed. A shape with no group is absent.
 */
export function shapeGroupAncestors(xml: string): Map<string, string[]> {
  const ancestors = new Map<string, string[]>();
  const stack: Array<string | null> = [];
  const token = /<p:grpSp\b|<\/p:grpSp>|<p:cNvPr\b[^>]*\bid="(\d+)"/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml)) !== null) {
    if (match[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    if (match[0].startsWith("<p:grpSp")) {
      stack.push(null);
      continue;
    }
    const id = match[1];
    if (stack.length > 0 && stack[stack.length - 1] === null) {
      stack[stack.length - 1] = id;
      continue;
    }
    const chain = stack.filter((groupId): groupId is string => groupId != null).reverse();
    if (chain.length) ancestors.set(id, chain);
  }
  return ancestors;
}

/**
 * Puts each click entrance on the imported shape. A click aimed at a group
 * lands on the shapes inside that group, unless a shape has its own entrance.
 * Returns how many shapes received an entrance.
 */
export function assignClickAnimations(
  xml: string,
  elements: {
    type?: string;
    animation?: string;
    animationOrder?: number;
    animationTrigger?: string;
    paragraphBuilds?: ParagraphBuild[];
    animationExit?: ExitBuild;
  }[],
  shapeIndex: ReadonlyMap<string, number | readonly number[]>,
): number {
  const clicks = readClickAnimations(xml);
  const byShape = new Map(
    clicks.filter((click) => !click.paragraph && !click.exit).map((click) => [click.spid, click]),
  );
  const ancestors = shapeGroupAncestors(xml);
  let mapped = 0;
  const indexesOf = (spid: string): readonly number[] => {
    const indexes = shapeIndex.get(spid);
    return typeof indexes === "number" ? [indexes] : indexes ?? [];
  };
  const apply = (spid: string, click: ClickAnimation) => {
    for (const index of indexesOf(spid)) applyElement(index, click);
  };
  const applyElement = (index: number, click: ClickAnimation) => {
    const el = elements[index];
    if (!el) return;
    // A with/after step before the first click plays as the slide arrives.
    if (click.order === 0) return;
    if (click.exit) {
      if (el.animationExit) return;
      el.animationExit = {
        order: click.order,
        ...(click.trigger === "with" || click.trigger === "after" ? { trigger: click.trigger } : {}),
      };
      mapped += 1;
      return;
    }
    if (click.paragraph) {
      // The shape's artwork has no paragraphs. Only its text follows a text build.
      if (el.type && el.type !== "text") return;
      el.paragraphBuilds = [
        ...(el.paragraphBuilds ?? []),
        {
          start: click.paragraph.start,
          end: click.paragraph.end,
          order: click.order,
          ...(click.trigger === "with" || click.trigger === "after"
            ? { trigger: click.trigger }
            : {}),
        },
      ];
      mapped += 1;
      return;
    }
    if (el.animation) return;
    el.animation = click.kind;
    el.animationOrder = click.order;
    if (click.trigger === "with" || click.trigger === "after") el.animationTrigger = click.trigger;
    mapped += 1;
  };
  for (const click of clicks) apply(click.spid, click);
  for (const spid of shapeIndex.keys()) {
    const parts = indexesOf(spid).map((index) => elements[index]);
    if (parts.some((el) => el?.animation || el?.paragraphBuilds?.length))
      continue;
    for (const groupId of ancestors.get(spid) ?? []) {
      const click = byShape.get(groupId);
      if (!click) continue;
      apply(spid, click);
      break;
    }
  }
  const groupExits = new Map(
    clicks.filter((click) => click.exit && !click.paragraph).map((click) => [click.spid, click]),
  );
  for (const spid of shapeIndex.keys()) {
    if (indexesOf(spid).some((index) => elements[index]?.animationExit)) continue;
    for (const groupId of ancestors.get(spid) ?? []) {
      const click = groupExits.get(groupId);
      if (!click) continue;
      apply(spid, click);
      break;
    }
  }
  return mapped;
}

function buildTiming(items: ClickAnimation[]): string {
  const clicks = items
    .map((item, index) => {
      const id = index * 2 + 3;
      const nodeType =
        item.trigger === "after"
          ? "afterEffect"
          : item.trigger === "with" || (index > 0 && item.order === items[index - 1]?.order)
            ? "withEffect"
            : "clickEffect";
      return `<p:par><p:cTn id="${id}" fill="hold" nodeType="${nodeType}"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:animEffect transition="in" filter="${FILTER[item.kind]}"><p:cBhvr><p:cTn id="${id + 1}" dur="500"/><p:tgtEl><p:spTgt spid="${item.spid}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
    })
    .join("");
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clicks}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}

const OFFICE_INNER = /^<p(?:14)?:[A-Za-z0-9]+\b[^<>]*\/>$/;

const SLIDE_PLAYBACK = new Set([
  "wipe",
  "cover",
  "pull",
  "strips",
  "split",
  "zoom",
  "newsflash",
  "wheel",
]);

function playbackType(name: string): SlideTransition["type"] {
  if (name === "cut") return "none";
  if (name === "push") return "push";
  if (SLIDE_PLAYBACK.has(name)) return "slide";
  return "fade";
}

function readTransition(xml: string): SlideTransition | undefined {
  const paired = /<p:transition\b([^>]*)>([\s\S]*?)<\/p:transition>/.exec(xml);
  const single = paired ? null : /<p:transition\b([^>]*)\/>/.exec(xml);
  const match = paired ?? single;
  if (!match) return undefined;
  const attrs = match[1] ?? "";
  const inner = (match[2] ?? "").trim();
  const adv = /(?:^|\s)advTm="(\d+)"/.exec(attrs);
  const spd = /(?:^|\s)spd="(slow|med|fast)"/.exec(attrs);
  let duration = 0.5;
  if (adv) duration = Math.min(10, Math.max(0, Number(adv[1]) / 1000));
  else if (spd?.[1] === "slow") duration = 1;
  else if (spd?.[1] === "fast") duration = 0.3;
  const child = /<p(?:14)?:([A-Za-z0-9]+)\b/.exec(inner)?.[1] ?? "";
  const office = OFFICE_INNER.test(inner) ? inner : undefined;
  return { type: playbackType(child), duration, ...(office ? { office } : {}) };
}

function readTiming(xml: string): string | undefined {
  const match = /<p:timing\b[\s\S]*?<\/p:timing>/.exec(xml) ?? /<p:timing\b[^>]*\/>/.exec(xml);
  if (!match) return undefined;
  const timing = match[0];
  if (timing.length > 100_000 || /<!DOCTYPE|<!ENTITY/.test(timing)) return undefined;
  return timing;
}

/** Transition and animation markup stored on one slide. */
export function readSlideMotion(xml: string): { transition?: SlideTransition; timing?: string } {
  const transition = readTransition(xml);
  const timing = readTiming(xml);
  return {
    ...(transition ? { transition } : {}),
    ...(timing ? { timing } : {}),
  };
}

function transitionMarkup(slide: Slide): string {
  const transition = slide.transition;
  if (transition?.office && OFFICE_INNER.test(transition.office))
    return `<p:transition>${transition.office}</p:transition>`;
  if (!transition || transition.type === "none") return "";
  const child =
    transition.type === "push"
      ? `<p:push dir="l"/>`
      : transition.type === "slide"
        ? `<p:wipe dir="r"/>`
        : `<p:fade/>`;
  const spd = transition.duration >= 0.8 ? "slow" : transition.duration <= 0.35 ? "fast" : "med";
  return `<p:transition spd="${spd}">${child}</p:transition>`;
}

function storedTiming(timing: string | undefined): string {
  if (
    timing &&
    timing.startsWith("<p:timing") &&
    timing.length <= 100_000 &&
    !/<!DOCTYPE|<!ENTITY/.test(timing)
  )
    return timing;
  return "";
}

function contentShapeIds(xml: string): string[] {
  const body = xml.replace(/<p:nvGrpSpPr\b[\s\S]*?<\/p:nvGrpSpPr>/g, "");
  return [...body.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => match[1]);
}

function timingMarkup(slide: Slide, xml: string): string {
  const ids = contentShapeIds(xml);
  const names = [...xml.replace(/<p:nvGrpSpPr\b[\s\S]*?<\/p:nvGrpSpPr>/g, "").matchAll(/<p:cNvPr\b[^>]*>/g)];
  const elementIds = new Map<string, string[]>();
  const sourceIds = new Map<string, string>();
  for (const element of slide.elements) {
    const found = names.filter((match) => match[0].includes(element.id)).map((match) => /\bid="(\d+)"/.exec(match[0])![1]);
    if (found.length) elementIds.set(element.id, found);
    if (element.sourceShapeId && found.length) sourceIds.set(element.sourceShapeId, found.at(-1)!);
  }
  const sequence = animationSequence(slide.elements);
  if (sequence.length) {
    const pairs = sequence.flatMap((item) => {
      const targets = elementIds.get(item.id) ?? (elementIds.size === 0 && ids[item.index] ? [ids[item.index]] : []);
      return targets.map((spid) => ({ spid, kind: item.kind, order: item.order, trigger: item.trigger, paragraphs: item.paragraphs, exit: item.exit }));
    });
    return pairs.length ? buildTiming(pairs) : "";
  }
  const retained = storedTiming(slide.timing);
  if (!retained) return "";
  // Source shape ids are scoped to the old slide. Never emit dangling targets.
  const remapped = retained.replace(/\bspid="(\d+)"/g, (_, id) => `spid="${sourceIds.get(id) ?? id}"`);
  return [...remapped.matchAll(/\bspid="(\d+)"/g)].every((match) => ids.includes(match[1])) ? remapped : "";
}

function motionMarkup(slide: Slide, xml: string): string {
  return `${transitionMarkup(slide)}${timingMarkup(slide, xml)}`;
}

/** Writes each slide's transition and animation into the PowerPoint package. */
export async function stampSlideMotion(bytes: Uint8Array, slides: Slide[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(/slide(\d+)/i.exec(a)?.[1] ?? 0) - Number(/slide(\d+)/i.exec(b)?.[1] ?? 0));
  let changed = false;
  for (let i = 0; i < names.length && i < slides.length; i++) {
    const file = zip.file(names[i]);
    if (!file) continue;
    let xml = await file.async("string");
    const extra = motionMarkup(slides[i], xml);
    if (!extra) continue;
    xml = xml
      .replace(/<p:transition\b[\s\S]*?<\/p:transition>/g, "")
      .replace(/<p:transition\b[^>]*\/>/g, "")
      .replace(/<p:timing\b[\s\S]*?<\/p:timing>/g, "")
      .replace(/<p:timing\b[^>]*\/>/g, "");
    if (!xml.includes("</p:sld>")) continue;
    zip.file(names[i], xml.replace("</p:sld>", `${extra}</p:sld>`));
    changed = true;
  }
  if (!changed) return bytes;
  return zip.generateAsync({ type: "uint8array" });
}

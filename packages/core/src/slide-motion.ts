import JSZip from "jszip";
import type { Slide, SlideElement, SlideTransition } from "./index";

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

export type ClickAnimation = {
  spid: string;
  kind: SlideAnimationKind;
  order: number;
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
    if (!withPrevious) order += 1;
    if (out.some((item) => item.spid === spid)) continue;
    out.push({ spid, kind: kindFromFilter(filter, chunk), order: Math.max(1, order) });
  }
  return out;
}

function buildTiming(items: ClickAnimation[]): string {
  const clicks = items
    .map((item, index) => {
      const id = index * 2 + 3;
      return `<p:par><p:cTn id="${id}" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:animEffect transition="in" filter="${FILTER[item.kind]}"><p:cBhvr><p:cTn id="${id + 1}" dur="500"/><p:tgtEl><p:spTgt spid="${item.spid}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
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
  if (!transition || transition.type === "none") return "";
  if (transition.office && OFFICE_INNER.test(transition.office))
    return `<p:transition>${transition.office}</p:transition>`;
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
  const animated = slide.elements
    .map((el, index) => ({ el, index }))
    .filter((item): item is { el: SlideElement; index: number } => isSlideAnimation(item.el.animation));
  if (animated.length) {
    const ids = contentShapeIds(xml);
    const pairs = animated.map((item, index) => ({
      spid: ids.length === slide.elements.length ? ids[item.index] : String(1000 + index),
      kind: item.el.animation as SlideAnimationKind,
      order: item.el.animationOrder ?? item.index + 1,
    }));
    pairs.sort((a, b) => a.order - b.order || Number(a.spid) - Number(b.spid));
    return buildTiming(pairs);
  }
  return storedTiming(slide.timing);
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

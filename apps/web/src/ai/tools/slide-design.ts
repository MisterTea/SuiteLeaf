import { Type } from "@earendil-works/pi-ai";
import type { Slide, SlideElement } from "@suiteleaf/core";
import { applyBackground, backgroundColors } from "../../editors/slide-layouts";
import {
  DECK_THEMES,
  applyDeckTheme,
  customizeTheme,
  normalizeHex,
  setTransitions,
  type TransitionType,
} from "../../editors/slide-theme";
import { applyLibraryTheme, readThemeLibrary, saveNamedTheme } from "../../editors/slide-theme-library";
import { FADE_ON_CLICK, applyFadeOnClick } from "../../editors/slide-fade-in";
import { ToolError, currentSnapshot, currentSuiteTools, tool, type SuiteTool } from "../host";
import type { SlidesAgentContext } from "./slides";
import { type Deck, textOf, titleOf } from "./slide-describe";
import {
  wait,
  plainArg,
  findSlide,
  asWhich,
  splitSlideList,
  stringArgs,
  resolveIds,
  thumbnail,
  canvas,
  pickColor,
  slideUpdater,
  slideButtonOf,
} from "./slide-targets";

function matchTheme(name: string) {
  const n = name.toLowerCase().replace(/^the\s+/, "").replace(/\s+theme$/i, "").trim();
  if (n.length < 3) return undefined;
  const exact = DECK_THEMES.find((theme) => theme.id === n || theme.name.toLowerCase() === n);
  if (exact) return exact;
  return DECK_THEMES.find(
    (theme) =>
      n.includes(theme.id) ||
      n.includes(theme.name.toLowerCase()) ||
      theme.id.includes(n) ||
      theme.name.toLowerCase().includes(n),
  );
}

function accentHex(value: string) {
  const found = value.match(/#?[0-9a-fA-F]{6}\b/);
  const hex = found ? normalizeHex(found[0]) : null;
  if (!hex) throw new ToolError(`"${value}" is not a colour code. Use #rrggbb, such as #2E7D32.`);
  return hex;
}

function themeArgs(args: Record<string, unknown>) {
  const next = { ...args };
  if (next.theme === undefined && typeof next.name === "string") next.theme = next.name;
  if (next.accent === undefined && typeof next.color === "string") next.accent = next.color;
  if (typeof next.theme === "string")
    next.theme = next.theme.replace(/^the\s+/i, "").replace(/\s+theme$/i, "").trim();
  delete next.name;
  delete next.color;
  return next;
}

/** Library tools take a name; models often send it as theme or title. */
function savedNameArgs(args: Record<string, unknown>) {
  const next = { ...args };
  if (typeof next.name !== "string") {
    for (const key of ["theme", "title", "theme_name", "themeName"]) {
      if (typeof next[key] === "string") {
        next.name = next[key];
        break;
      }
    }
  }
  if (typeof next.name === "string")
    next.name = next.name
      .replace(/#?[0-9a-fA-F]{6}\b/g, " ")
      .replace(/[.!?\s]+$/g, "")
      .replace(/^the\s+/i, "")
      .replace(/\s+theme$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  return { name: next.name };
}

function findSavedTheme(raw: string) {
  const name = raw.trim().toLowerCase();
  const library = readThemeLibrary();
  if (name.length < 3) return { theme: undefined, library };
  const theme =
    library.find((item) => item.name.toLowerCase() === name) ??
    library.find((item) => name.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(name));
  return { theme, library };
}

/** A presentation title from a model argument. */
function fileTitle(raw: string) {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(the\s+)?(presentation|deck|file)\s+/i, "")
    .replace(/\.slslides$/i, "")
    .replace(/[.!?]+$/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

/** save_theme can also open another presentation and copy the saved look onto it. */
function saveThemeArgs(args: Record<string, unknown>) {
  const named = savedNameArgs(args);
  let applyTo = "";
  for (const key of ["apply_to", "applyTo", "file", "deck", "presentation", "to"]) {
    if (typeof args[key] === "string" && args[key].trim()) {
      applyTo = fileTitle(args[key]);
      break;
    }
  }
  if (!applyTo && typeof named.name === "string") {
    const split = /^(.*?)\s+to\s+(?:the\s+)?(?:presentation\s+|deck\s+|file\s+)?(.+)$/i.exec(named.name);
    if (split && split[1].trim().length >= 3 && fileTitle(split[2]).length >= 3) {
      named.name = split[1].trim();
      applyTo = fileTitle(split[2]);
    }
  }
  return applyTo ? { name: named.name, apply_to: applyTo } : { name: named.name };
}

const toolText = (out: string | { text: string }) => (typeof out === "string" ? out : out.text);

const themeButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Theme");

/** "4 to 6" and "4-6" become the slide numbers in between. */
function expandSlideSpec(spec: string): string[] {
  const expanded = spec.replace(/(\d+)\s*(?:-|–|—|to|through)\s*(\d+)/gi, (_, a, b) => {
    const from = Number(a);
    const to = Number(b);
    const step = from <= to ? 1 : -1;
    const nums: string[] = [];
    for (let n = from; n !== to + step; n += step) nums.push(String(n));
    return nums.join(", ");
  });
  return splitSlideList(expanded.replace(/\bslides?\b/gi, " "));
}

function isAllSlides(spec: string) {
  const t = spec
    .replace(/\bslides?\b/gi, " ")
    .replace(/[^a-z]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t === "" || t === "all" || t === "every" || t === "each" || t === "the deck" || t === "whole deck";
}

function transitionArgs(args: Record<string, unknown>) {
  const next = { ...args };
  if (next.type === undefined && typeof next.transition === "string") next.type = next.transition;
  if (Array.isArray(next.slides)) next.slides = next.slides.map(String).join(", ");
  if (typeof next.slides === "number") next.slides = String(next.slides);
  if (Array.isArray(next.except)) next.except = next.except.map(String).join(", ");
  if (typeof next.except === "number") next.except = String(next.except);
  if (typeof next.duration === "string") {
    const n = Number(next.duration.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) next.duration = n > 10 && n <= 10000 ? n / 1000 : n;
  }
  if (typeof next.slides === "string" && next.except === undefined) {
    const except = /^(.*?)\s*\bexcept\s+(.+)$/i.exec(next.slides.trim());
    if (except) {
      next.slides = except[1].trim() || "all";
      next.except = except[2].trim();
    }
  }
  if (typeof next.type === "string") {
    const v = next.type.toLowerCase();
    if (v.includes("fade")) next.type = "fade";
    else if (v.includes("push")) next.type = "push";
    else if (v.includes("none") || v.includes("cut") || v === "off") next.type = "none";
    else if (/\bslide\b/.test(v)) next.type = "slide";
  }
  delete next.transition;
  return next;
}

function transitionSummary(deck: Deck) {
  const lines = deck.slideOrder.map((id, i) => `${i + 1} ${deck.slides[id].transition?.type ?? "none"}`);
  return `Transitions: ${lines.join(", ")}.`;
}

const CHART_AXIS = new Set(["jul", "aug", "sep", "oct"]);

/** One entrance: fade in on the next click. A bare "fade" here is that entrance, not a slide transition. */
function wantsFadeOnClick(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  const text = value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(after previous|with previous|on load|none|off|remove)\b/.test(text)) return false;
  if (/^(slide|push)$/.test(text)) return false;
  return /fade|on click|entrance|appear/.test(text);
}

function animatePrepare(args: Record<string, unknown>) {
  const next = stringArgs(args);
  const object = plainArg(next.object, next.element, next.target, next.text, next.name, next.callout, next.on, next.box);
  const animation = [plainArg(next.animation, next.effect, next.entrance, next.type), plainArg(next.trigger, next.when, next.start)]
    .filter(Boolean)
    .join(" ");
  const out: Record<string, unknown> = {};
  if (object) out.object = object;
  if (animation) out.animation = animation;
  if (next.slide !== undefined && next.slide !== "") out.slide = String(next.slide);
  return out;
}

/**
 * The one object to fade in. "September" and "September callout" are the callout.
 * Chart bars and the Sep axis label are refused so they stay without an entrance.
 */
function findFadeTarget(slide: Slide, object: string | undefined): SlideElement {
  const hint = (object ?? "")
    .trim()
    .toLowerCase()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^(?:the|a|an|only)\s+/, "")
    .replace(/\s+object$/, "")
    .trim();
  const callout = slide.elements.find((el) => el.type === "text" && textOf(el).trim().toLowerCase() === "september");
  if (!hint || /\b(september|callout)\b/.test(hint)) {
    if (callout) return callout;
  }
  if (CHART_AXIS.has(hint) || /\b(chart|graph|bars?)\b/.test(hint)) {
    throw new ToolError(
      'That is the chart. Call animate_object with object "September" and animation "fade-on-click". Do not animate the chart, and do not change the slide transition.',
    );
  }
  const exact = slide.elements.find((el) => el.type === "text" && textOf(el).trim().toLowerCase() === hint);
  if (exact) return exact;
  const byId = slide.elements.find((el) => el.id.toLowerCase() === hint);
  if (byId) return byId;
  const listed = slide.elements
    .filter((el) => el.type === "text" && textOf(el).trim())
    .map((el) => `"${textOf(el).replace(/\n/g, " ").slice(0, 40)}"`)
    .join(", ");
  throw new ToolError(
    `No object matches "${object ?? ""}". Text on this slide: ${listed || "none"}. For the September callout, pass object "September" and animation "fade-on-click".`,
  );
}

export function slideDesignTools(ctx: SlidesAgentContext): SuiteTool[] {
  const update = slideUpdater(ctx);
  const slideButton = slideButtonOf(ctx);
  return [
    tool({
      name: "set_background",
      label: "Background",
      description: `Set the background color of one slide (the current one, or \`slide\`), or of every slide with all_slides=true (section headers keep theirs). color: a name such as sage green, warm sand or deep navy, or #rrggbb. To restyle the whole deck (background, fonts, and accent together), use apply_theme instead.`,
      parameters: Type.Object({ color: Type.String(), slide: Type.Optional(Type.Number()), all_slides: Type.Optional(Type.Boolean()) }),
      target: ({ slide, all_slides }) => slideButton(all_slides ? undefined : slide, "Background"),
      execute({ color, slide, all_slides }) {
        const deck = ctx.deck();
        const paint = pickColor(color, backgroundColors, "Background");
        if (all_slides) {
          ctx.commit({ ...deck, slides: applyBackground(deck.slides, paint.color, true) });
          return `Every slide now has a ${paint.name} background.`;
        }
        const { id, index } = findSlide(deck, slide, ctx.activeSlideId);
        update(id, (s) => applyBackground({ [id]: s }, paint.color)[id]);
        ctx.select(id, null);
        return `Slide ${index + 1} "${titleOf(deck.slides[id])}" now has a ${paint.name} background; the other slides keep theirs.`;
      },
    }),
    tool({
      name: "apply_theme",
      label: "Apply theme",
      description:
        "Apply one built-in look to every slide: background, heading font, body font, text colours, and the accent colour on shapes. Themes: Meadow (deep green, white Montserrat headings, Source Sans body), Paper, Ink, Warm Sand. Free text boxes follow the theme, except a box already marked as overriding it. accent sets the theme accent to a #rrggbb colour such as #2E7D32 and updates every shape. Call this again with only accent to change the colour after a theme is already on. A theme stored with save_theme is applied with apply_saved_theme, not this tool. This does not change the theme library or any other deck.",
      parameters: Type.Object({
        theme: Type.Optional(Type.String({ description: "Meadow, Paper, Ink, or Warm Sand." })),
        accent: Type.Optional(Type.String({ description: "Accent colour as #rrggbb, such as #2E7D32." })),
      }),
      prepare: themeArgs,
      target: () => themeButton(),
      execute({ theme, accent }) {
        const deck = ctx.deck();
        let colour = accent;
        let themeName = theme;
        if (themeName) {
          const hex = themeName.match(/#?[0-9a-fA-F]{6}\b/);
          if (!colour && hex) colour = hex[0];
          themeName = themeName.replace(/#?[0-9a-fA-F]{6}\b/g, " ").replace(/\s+/g, " ").trim();
        }
        let next = deck;
        if (themeName) {
          const found = matchTheme(themeName);
          if (found) {
            // Reapplying the theme already on the deck keeps a custom accent or font.
            const theme = deck.theme?.id === found.id ? { ...deck.theme } : { ...found };
            next = applyDeckTheme(deck, theme);
          } else {
            const { theme: saved, library } = findSavedTheme(themeName);
            if (!saved) {
              const names = library.map((item) => `"${item.name}"`).join(", ");
              throw new ToolError(
                `No built-in theme named "${theme}". Choose Meadow, Paper, Ink, or Warm Sand.${names ? ` Saved themes: ${names}. Copy one with apply_saved_theme, or save_theme with apply_to set to the other presentation.` : " A theme saved with save_theme is applied with apply_saved_theme, not apply_theme."}`,
              );
            }
            next = applyLibraryTheme(deck, saved);
          }
        } else if (!deck.theme) {
          throw new ToolError(
            "Name a built-in theme first: Meadow, Paper, Ink, or Warm Sand. Or call apply_saved_theme with a name from save_theme. To change only the accent, pass accent and no theme name.",
          );
        }
        if (colour) next = customizeTheme(next, { accent: accentHex(colour) });
        if (!next.theme) throw new ToolError("Name a theme first: Meadow, Paper, Ink, or Warm Sand.");
        ctx.commit(next);
        ctx.select(next.slideOrder[0], null);
        const kept = next.slideOrder.flatMap((id, i) =>
          next.slides[id].elements
            .filter((el) => el.themeOverride && el.type === "text")
            .map((el) => `slide ${i + 1} "${(el.content ?? "").slice(0, 80)}" stays ${el.fontFamily ?? "as set"}${el.italic ? ", italic" : ""}`),
        );
        return `Applied ${next.theme.name} to "${ctx.title}", all ${next.slideOrder.length} slides. Background ${next.theme.background}, headings ${next.theme.headingFont}, body ${next.theme.bodyFont}, accent ${next.theme.accent}.${kept.length ? ` Left alone because they override the theme: ${kept.join("; ")}.` : " No text box overrides the theme."} The theme library and other decks were not changed.`;
      },
    }),
    tool({
      name: "save_theme",
      label: "Save theme",
      description:
        "Save the open deck's current theme to this computer's theme library under name, including its background, heading font, body font, and accent. Pass apply_to with another presentation's title to open that presentation and copy the saved theme onto every slide in the same call. The library stores a copy. Later edits to either deck do not change that saved theme. Refuses when this deck has no theme. Without apply_to, the open deck is unchanged. Do not use apply_theme for a theme saved this way.",
      parameters: Type.Object({
        name: Type.String({ description: "Library name, such as Centre green." }),
        apply_to: Type.Optional(
          Type.String({ description: "Title of the other presentation that should use this saved theme, such as Spring classes." }),
        ),
      }),
      prepare: saveThemeArgs,
      target: () => themeButton(),
      async execute({ name, apply_to }) {
        const current = ctx.deck().theme;
        if (!current)
          throw new ToolError("This deck has no theme to save. Apply Meadow, Paper, Ink, or Warm Sand first.");
        const result = saveNamedTheme(current, name);
        if (!result.ok) throw new ToolError(result.error);
        const saved = result.saved;
        const savedLine = `Saved "${saved.name}" to the theme library: background ${saved.background}, headings ${saved.headingFont}, body ${saved.bodyFont}, accent ${saved.accent}.`;
        if (!apply_to) {
          return `${savedLine} This deck is unchanged. The library keeps accent ${saved.accent} even if another deck later uses a different accent. To use it on another presentation in one call, call save_theme again with the same name and apply_to set to that presentation's title. Or call back_to_files, then open_file with that title, then apply_saved_theme with name "${saved.name}". Do not call apply_theme.`;
        }
        if (apply_to.toLowerCase() === ctx.title.toLowerCase()) {
          throw new ToolError(
            `${savedLine} apply_to must be the other presentation, not "${ctx.title}". Call back_to_files, then open_file with the other title, then apply_saved_theme with name "${saved.name}".`,
          );
        }
        const back = currentSuiteTools().find((item) => item.name === "back_to_files");
        if (!back) throw new ToolError(`${savedLine} Could not leave this deck to open "${apply_to}".`);
        await back.execute({});
        const wanted = `"${apply_to.toLowerCase()}"`;
        let listed = "";
        let open = currentSuiteTools().find((item) => item.name === "open_file");
        for (let attempt = 0; attempt < 30; attempt++) {
          listed = currentSnapshot();
          open = currentSuiteTools().find((item) => item.name === "open_file");
          if (open && listed.toLowerCase().includes(wanted)) break;
          await wait(200);
        }
        if (!listed.toLowerCase().includes(wanted)) {
          throw new ToolError(
            `${savedLine} "${apply_to}" is not on the file list, so it was not opened.\n${listed}\nCall open_file with the presentation's exact title, then apply_saved_theme with name "${saved.name}".`,
          );
        }
        if (!open) throw new ToolError(`${savedLine} Back on the file list, but the file list is not ready to open "${apply_to}".\n${listed}`);
        const openedText = toolText(await open.execute({ name: apply_to }));
        if (/pick it from their computer/i.test(openedText)) {
          throw new ToolError(
            `${savedLine} "${apply_to}" was not opened from the library.\n${openedText}\nCall open_file with the exact title, then apply_saved_theme with name "${saved.name}".`,
          );
        }
        const apply = currentSuiteTools().find((item) => item.name === "apply_saved_theme");
        if (!apply)
          throw new ToolError(
            `${savedLine} "${apply_to}" did not open as a presentation.\n${openedText}\nWhen that presentation is open, call apply_saved_theme with name "${saved.name}".`,
          );
        const applied = toolText(await apply.execute({ name: saved.name }));
        return `${savedLine} ${applied} The task is finished. Do not call apply_theme, and do not change the accent.`;
      },
    }),
    tool({
      name: "apply_saved_theme",
      label: "Apply saved theme",
      description:
        "Copy a theme saved with save_theme onto the open deck only: background, heading font, body font, text colours, and the accent on shapes. Free text boxes follow it, except a box already marked as overriding the theme. name is the library name, such as Centre green. This copies the library entry onto this deck. It does not change the library entry, any other deck, or the built-in themes. To change only this deck's accent afterwards, call apply_theme with accent and no theme name.",
      parameters: Type.Object({
        name: Type.String({ description: "Library name, such as Centre green." }),
      }),
      prepare: savedNameArgs,
      target: () => themeButton(),
      execute({ name }) {
        const { theme, library } = findSavedTheme(name);
        if (!theme) {
          const names = library.map((item) => `"${item.name}"`).join(", ") || "none";
          throw new ToolError(
            `No saved theme named "${name}". Library: ${names}. save_theme stores the open deck's theme first.`,
          );
        }
        const next = applyLibraryTheme(ctx.deck(), theme);
        ctx.commit(next);
        ctx.select(next.slideOrder[0], null);
        const kept = next.slideOrder.flatMap((id, i) =>
          next.slides[id].elements
            .filter((el) => el.themeOverride && el.type === "text")
            .map((el) => `slide ${i + 1} "${(el.content ?? "").slice(0, 80)}" stays ${el.fontFamily ?? "as set"}${el.italic ? ", italic" : ""}`),
        );
        return `Copied "${theme.name}" onto "${ctx.title}" only. Background ${theme.background}, headings ${theme.headingFont}, body ${theme.bodyFont}, accent ${theme.accent}. The library entry is unchanged, and other decks were not changed.${kept.length ? ` Left alone because they override the theme: ${kept.join("; ")}.` : " No text box overrides the theme."} If the user asked to change only this deck's accent, call apply_theme with that accent and no theme name. Otherwise stop.`;
      },
    }),
    tool({
      name: "set_transition",
      label: "Transition",
      description:
        "Set how one slide changes into the next. type is fade, none (a cut), slide (from the right), or push. slides defaults to all. except lists slides that get no transition while the others get type, for example type fade and except \"4-6\" or \"4, 5, 6\". Duration defaults to 0.4 seconds. This does not animate an object. To fade one object in on the next click, call animate_object.",
      parameters: Type.Object({
        type: Type.String({ enum: ["none", "fade", "slide", "push"] }),
        slides: Type.Optional(Type.String({ description: "all, one slide number, or several such as 4-6 or 4, 5, 6. Default: all." })),
        except: Type.Optional(Type.String({ description: "Slides that get no transition, such as 4-6." })),
        duration: Type.Optional(Type.Number({ description: "Seconds, default 0.4." })),
      }),
      prepare: transitionArgs,
      target: ({ slides, except }) => {
        try {
          const spec = String(except ?? slides ?? "1");
          const first = expandSlideSpec(spec).find((part) => /^\d+$/.test(part));
          return thumbnail(first ? Number(first) - 1 : 0);
        } catch {
          return thumbnail(0);
        }
      },
      execute({ type, slides, except, duration }) {
        const deck = ctx.deck();
        const kind = type as TransitionType;
        let seconds = duration ?? 0.4;
        if (seconds > 10 && seconds <= 10000) seconds /= 1000;
        seconds = Math.min(10, Math.max(0, seconds));
        const exceptIds = except ? resolveIds(deck, expandSlideSpec(except), ctx.activeSlideId) : [];
        const target = slides ?? "all";
        const ids = isAllSlides(target)
          ? deck.slideOrder.filter((id) => !exceptIds.includes(id))
          : resolveIds(deck, expandSlideSpec(target), ctx.activeSlideId);
        let next = setTransitions(deck, ids, { type: kind, duration: seconds });
        if (exceptIds.length) next = setTransitions(next, exceptIds, { type: "none", duration: seconds });
        ctx.commit(next);
        ctx.select(ids[0] ?? deck.slideOrder[0], null);
        return transitionSummary(next);
      },
    }),
    tool({
      name: "animate_object",
      label: "Fade in on click",
      description:
        'Set an entrance on one object. object is text in that object. animation is "fade-on-click": the object stays visible while editing, and in the slideshow it is hidden until the next click, which does not advance the slide. Other objects are unchanged. The slide transition is not changed.',
      parameters: Type.Object({
        object: Type.String({ description: "Text in the one object to animate." }),
        animation: Type.Optional(Type.String({ description: 'fade-on-click. Fade in on the next click.' })),
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
      }),
      prepare: animatePrepare,
      target: ({ slide, object }) => {
        try {
          const found = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
          const element = findFadeTarget(ctx.deck().slides[found.id], object);
          return document.querySelector(`.slide-canvas [data-element-id="${CSS.escape(element.id)}"]`) ?? canvas();
        } catch {
          return canvas();
        }
      },
      async execute({ object, animation, slide }) {
        if (!wantsFadeOnClick(animation))
          throw new ToolError(
            'animate_object only sets fade in on click. It does not change the slide transition. Call it with object "September" and animation "fade-on-click".',
          );
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const element = findFadeTarget(ctx.deck().slides[id], object);
        const marked = applyFadeOnClick(ctx.deck(), id, element.id);
        if (marked) {
          ctx.commit(marked);
          await wait(300);
        }
        ctx.select(id, element.id);
        const saved = ctx.deck().slides[id];
        const kept = saved.elements.find((el) => el.id === element.id);
        if (!kept) throw new ToolError("The object was removed. It must stay on the slide.");
        if (kept.animation !== FADE_ON_CLICK)
          throw new ToolError(`"${textOf(kept) || kept.id}" is still on the slide, but it does not fade in on click.`);
        const stray = saved.elements.filter((el) => el.id !== kept.id && el.animation);
        const label = textOf(kept) || kept.id;
        const others = stray.length
          ? ` Other objects still have an entrance: ${stray.map((el) => textOf(el) || el.type).join(", ")}.`
          : " No other object on the slide has an entrance animation. The chart was not animated.";
        const transition = saved.transition ? ` The slide transition is still ${saved.transition.type}.` : " The slide transition was not changed.";
        return `"${label}" on slide ${index + 1} fades in on the next click. It is still on the slide. In the slideshow it stays hidden until that click, and the click does not advance the slide.${others}${transition} Stop. Do not call another tool.`;
      },
    }),
  ];
}

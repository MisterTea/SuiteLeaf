import { Type } from "@earendil-works/pi-ai";
import { readThemeLibrary } from "../../editors/slide-theme-library";
import { ToolError, tool, type SuiteTool } from "../host";
import { type Deck, titleOf, describeSlide } from "./slide-describe";
import { wait, findSlide, thumbnail } from "./slide-targets";
import { slideContentTools } from "./slide-content";
import { slideObjectTools } from "./slide-objects";
import { slideDesignTools } from "./slide-design";
import { slideArrangeTools } from "./slide-arrange";
import { slideCommentTools } from "./slide-comments";
import { slideSpellingTools } from "./slide-spelling";

export { slideSpellingReview } from "./slide-spelling";

/** What the Slides editor lends the agent. */
export interface SlidesAgentContext {
  title: string;
  deck: () => Deck;
  commit: (deck: Deck) => void;
  activeSlideId: string;
  select: (slideId: string, elementId?: string | null) => void;
  presenting: boolean;
  present: (fromIndex: number, withNotes: boolean) => void;
  goToShowSlide: (index: number) => void;
  showIndex: number;
  endShow: () => void;
  readImage: (file: File) => Promise<string>;
  exportAs: (format: "pptx" | "html" | "txt") => Promise<void>;
  /** The object selected on the current slide, if any. */
  selectedElementId: string | null;
  /** Copy objects onto the editor clipboard (the same one Edit › Copy uses). */
  copyElements: (slideId: string, elementIds: string[]) => boolean;
  /** Paste the copied objects onto a slide at their original position. */
  pasteElements: (slideId: string) => { id: string; type: string; x: number; y: number; shapeType?: string }[];
}

/** A slide show button, after bringing the hidden controls back the way moving the mouse does. */
async function showButton(label: string) {
  window.dispatchEvent(new Event("mousemove"));
  await wait(150);
  return [...document.querySelectorAll(".presenter-overlay button")].find((b) => b.textContent?.includes(label));
}

export function slideTools(ctx: SlidesAgentContext): SuiteTool[] {
  return [
    ...slideContentTools(ctx),
    ...slideObjectTools(ctx),
    ...slideDesignTools(ctx),
    ...slideArrangeTools(ctx),
    ...slideCommentTools(ctx),
    tool({
      name: "go_to_slide",
      label: "Go to slide",
      description: "Show a slide in the editor (or, while presenting, jump the show to it).",
      parameters: Type.Object({ slide: Type.Number() }),
      target: ({ slide }) => (ctx.presenting ? document.querySelector(".presenter-slide-box") : thumbnail(slide - 1)),
      execute({ slide }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        if (ctx.presenting) ctx.goToShowSlide(index);
        else ctx.select(id, null);
        return `Showing slide ${index + 1}.`;
      },
    }),
    tool({
      name: "start_presentation",
      label: "Present",
      description: "Start the slideshow from the first slide (or from `from_slide`), optionally with the speaker notes panel.",
      parameters: Type.Object({ from_slide: Type.Optional(Type.Number()), with_notes: Type.Optional(Type.Boolean()) }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Slideshow"),
      async execute({ from_slide, with_notes }) {
        const index = from_slide ? findSlide(ctx.deck(), from_slide, ctx.activeSlideId).index : 0;
        const deck = ctx.deck();
        ctx.present(index, !!with_notes);
        await wait(600);
        const screen = document.fullscreenElement
          ? "in full screen"
          : "in the window (the browser allows full screen only right after the user clicks or presses a key; they can click Full screen in the show's controls)";
        return `Presenting ${screen} from slide ${index + 1} of ${deck.slideOrder.length}, "${titleOf(deck.slides[deck.slideOrder[index]])}"${with_notes ? ", with the speaker notes beside it" : ""}. Use next_slide to advance and end_presentation to stop.`;
      },
    }),
    tool({
      name: "next_slide",
      label: "Next slide",
      description: "During the slideshow, go forward (or back with back=true) one slide.",
      parameters: Type.Object({ back: Type.Optional(Type.Boolean()) }),
      repeatable: true,
      target: ({ back }) => showButton(back ? "Previous" : "Next"),
      execute({ back }) {
        if (!ctx.presenting) throw new ToolError("The slideshow is not running. Use start_presentation first.");
        const deck = ctx.deck();
        const last = deck.slideOrder.length - 1;
        const next = Math.max(0, Math.min(last, ctx.showIndex + (back ? -1 : 1)));
        const name = (i: number) => `slide ${i + 1} of ${last + 1}, "${titleOf(deck.slides[deck.slideOrder[i]])}"`;
        if (next === ctx.showIndex)
          throw new ToolError(
            `The show is already on the ${back ? "first" : "last"} slide (${name(next)}); there is no ${back ? "previous" : "next"} one. end_presentation stops the show.`,
          );
        ctx.goToShowSlide(next);
        return `Showing ${name(next)}.${next === last ? " This is the last slide." : ""}`;
      },
    }),
    tool({
      name: "end_presentation",
      label: "End show",
      description: "Stop the slideshow and go back to editing.",
      parameters: Type.Object({}),
      target: () => showButton("Exit"),
      execute() {
        if (!ctx.presenting) return "The slideshow was not running; the editor is showing.";
        ctx.endShow();
        return "Stopped the slideshow; the editor is showing again.";
      },
    }),
    ...slideSpellingTools(ctx),
    tool({
      name: "export_presentation",
      label: "Export",
      description:
        "Export a copy in another format, for other apps: PowerPoint (pptx), a web page (html), or plain text (txt). Only when the user asks for one of these; to download or save the file itself, use download_file.",
      parameters: Type.Object({ format: Type.String({ enum: ["pptx", "html", "txt"] }) }),
      target: () => document.querySelector(".workspace-header [aria-haspopup]"),
      async execute({ format }) {
        await ctx.exportAs(format as "pptx");
        return `Exported "${ctx.title}.${format}".`;
      },
    }),
  ];
}

export function slideSnapshot(ctx: SlidesAgentContext) {
  const deck = ctx.deck();
  const current = deck.slideOrder.indexOf(ctx.activeSlideId) + 1;
  const theme = deck.theme
    ? ` Theme: ${deck.theme.name}, accent ${deck.theme.accent}, headings ${deck.theme.headingFont}, body ${deck.theme.bodyFont}.`
    : " No theme.";
  const library = readThemeLibrary();
  const saved = library.length
    ? ` Theme library: ${library.map((item) => `"${item.name}" accent ${item.accent}, headings ${item.headingFont}, body ${item.bodyFont}, background ${item.background}`).join("; ")}. apply_saved_theme copies one onto this deck.`
    : "";
  return `Open presentation: "${ctx.title}", ${deck.slideOrder.length} slide(s); slide ${current} is selected${ctx.presenting ? `; the slideshow is running on slide ${ctx.showIndex + 1}` : ""}.${theme}${saved}\n${deck.slideOrder
    .slice(0, 20)
    .map((id, i) => describeSlide(deck.slides[id], i))
    .join("\n")}`;
}

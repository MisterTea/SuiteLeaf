import { getSchema, Mark, Node as TiptapNode, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DOMSerializer, type DOMOutputSpec, type Node as ProseNode, type Schema } from "@tiptap/pm/model";
import { paintFontFamily, type TextRun } from "@suiteleaf/core";
import { runsToHtml } from "./slide-runs";
import { SlideLists } from "./slide-tiptap-lists";
import { paragraphAttributes, safeOfficeRun, type SlideTextMetrics } from "./slide-tiptap-model";

function decode(value: string | null): Record<string, unknown> {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

const sentinel = "SuiteLeafTextContent";

/** Reuse Office measurements and effects, with a real ProseMirror content slot. */
function officeDOM(runs: TextRun[], metrics: SlideTextMetrics): { dom: HTMLElement; contentDOM: HTMLElement } {
  const host = document.createElement("div");
  host.innerHTML = runsToHtml(runs, metrics.kern, metrics.hang, metrics);
  const dom = host.firstElementChild as HTMLElement;
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
  let text: Node | null;
  while ((text = walker.nextNode())) {
    if (text.textContent !== sentinel) continue;
    const contentDOM = text.parentElement!;
    contentDOM.replaceChildren();
    return { dom, contentDOM };
  }
  throw new Error("Slide text renderer did not produce a content slot");
}

function paragraphDOM(node: ProseNode, metrics: SlideTextMetrics): DOMOutputSpec {
  const office = node.attrs.office ?? {};
  const marker = (node.attrs.marker ?? []) as TextRun[];
  // The content slot must carry the paragraph's strut, just as runsToHtml's
  // words do. An unstyled sentinel inherits the box size and stretches every
  // smaller paragraph (including its wrapped lines) to that larger pitch.
  const words: Partial<TextRun>[] = [];
  node.forEach(child => {
    if (child.isText) words.push(child.marks.find(mark => mark.type.name === "officeRun")?.attrs.office ?? {});
  });
  const sizes = words.filter(run => !run.baseline).map(run => run.fontSize ?? metrics.fontSize).filter((size): size is number => !!size);
  const fontSize = sizes.length ? Math.min(...sizes) : node.attrs.breakRun?.fontSize;
  const font = words.find(run => run.font)?.font ?? metrics.fontFamily;
  const strut = { ...(fontSize ? { fontSize } : {}), ...(font ? { font } : {}) };
  const { dom, contentDOM } = officeDOM([
    ...marker.map((run, index) => index ? run : { ...run, ...office, ...(fontSize && !run.fontSize ? { fontSize } : {}) }),
    { text: sentinel, ...strut, ...(!marker.length ? office : {}) },
  ], metrics);
  dom.dataset.officeParagraph = JSON.stringify(node.attrs);
  contentDOM.dataset.slideContent = "1";
  // A symbol marker's font is a glyph style, not the paragraph's inherited font.
  if (marker.length) {
    const bodyFont = node.firstChild?.marks.find(mark => mark.type.name === "officeRun")?.attrs.office.font;
    dom.style.fontFamily = paintFontFamily(bodyFont ?? metrics.fontFamily ?? "Arial");
    dom.querySelectorAll<HTMLElement>(".slide-bullet-slot").forEach(slot => { slot.contentEditable = "false"; });
  }
  return { dom, contentDOM };
}

const cache = new Map<string, { extensions: Extensions; schema: Schema }>();

/** No Editor instance is constructed for a static text box. */
export function slideTextKit(metrics: SlideTextMetrics) {
  const key = JSON.stringify(metrics);
  const cached = cache.get(key);
  if (cached) return cached;
  const Paragraph = TiptapNode.create({
    name: "paragraph", group: "block", content: "inline*",
    addAttributes: () => ({
      office: { default: {}, rendered: false },
      breakRun: { default: null, rendered: false },
      marker: { default: null, rendered: false },
    }),
    parseHTML: () => [
      { tag: "[data-office-paragraph]", getAttrs: el => {
        const attrs = decode(el.getAttribute("data-office-paragraph"));
        return {
          office: paragraphAttributes(safeOfficeRun({ ...(attrs.office as object), text: "" })),
          breakRun: attrs.breakRun ? safeOfficeRun(attrs.breakRun) : null,
          marker: Array.isArray(attrs.marker) ? attrs.marker.map(safeOfficeRun).filter(run => run.text) : null,
        };
      }, contentElement: "[data-slide-content]" },
      { tag: "p" }, { tag: "div" },
    ],
    renderHTML: ({ node }) => paragraphDOM(node, metrics),
  });
  const OfficeRun = Mark.create({
    name: "officeRun", inclusive: true,
    addAttributes: () => ({ office: { default: {}, rendered: false } }),
    parseHTML: () => [{ tag: "[data-office-run]", getAttrs: el => {
      const office: Partial<TextRun> = safeOfficeRun({ ...decode(el.getAttribute("data-office-run")), text: "" });
      delete office.text;
      return { office };
    } }],
    renderHTML: ({ mark }) => {
      const { dom, contentDOM } = officeDOM([{ ...mark.attrs.office, text: sentinel }], metrics);
      const span = dom.firstElementChild as HTMLElement;
      span.dataset.officeRun = JSON.stringify(mark.attrs.office);
      return { dom: span, contentDOM };
    },
  });
  const OfficeInline = TiptapNode.create({
    name: "officeInline", group: "inline", inline: true, atom: true,
    addAttributes: () => ({ run: { default: { text: "" }, rendered: false } }),
    parseHTML: () => [{ tag: "[data-office-inline]", getAttrs: el => ({ run: safeOfficeRun(decode(el.getAttribute("data-office-inline"))) }) }],
    renderHTML: ({ node }) => {
      const host = document.createElement("span");
      host.dataset.officeInline = JSON.stringify(node.attrs.run);
      host.contentEditable = "false";
      host.innerHTML = runsToHtml([node.attrs.run], metrics.kern, undefined, metrics);
      return host;
    },
  });
  const extensions: Extensions = [StarterKit.configure({
    paragraph: false, blockquote: false, codeBlock: false, code: false,
    heading: false, horizontalRule: false, link: false, undoRedo: false,
    dropcursor: false, gapcursor: false, trailingNode: false,
  }), Paragraph, OfficeRun, OfficeInline, SlideLists];
  const kit = { extensions, schema: getSchema(extensions) };
  // Schemas hold layout closures. Bound the cache as decks use many font sizes.
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, kit);
  return kit;
}

export function renderSlideText(doc: ProseNode): DocumentFragment {
  const fragment = document.createDocumentFragment();
  DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content, {}, fragment);
  // Each paragraph is rendered separately through officeDOM, whose local
  // index is always zero. Restore document order across lists and empty
  // paragraphs so slideshow builds address the original text paragraphs.
  fragment.querySelectorAll<HTMLElement>("[data-office-paragraph]").forEach((paragraph, index) => {
    paragraph.dataset.paraIndex = String(index);
  });
  return fragment;
}


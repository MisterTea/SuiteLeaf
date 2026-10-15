import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { imageWrap, type ImageWrap } from "@suiteleaf/core/image-wrap";
import { liftInlineImage, placeImageInline } from "./doc-image-place";

type Placement = ImageWrap | "inline";

const CHOICES: { placement: Placement; label: string }[] = [
  { placement: "inline", label: "In line" },
  { placement: "left", label: "Left" },
  { placement: "right", label: "Right" },
  { placement: "break", label: "Break text" },
];

let menuSerial = 0;

const wrapIcon = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 4h7M14 8h7M3 15h18M3 19h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

export function imageWrapAttribute() {
  return {
    default: null as ImageWrap | null,
    parseHTML: (element: HTMLElement) =>
      imageWrap({ wrap: element.getAttribute("data-wrap") }),
    renderHTML: (attributes: Record<string, unknown>) => {
      const wrap = imageWrap(attributes);
      return wrap ? { "data-wrap": wrap } : {};
    },
  };
}

/** Writes the wrap and leaves the picture selected, so the menu can show the choice. */
export function applyImageWrap(editor: Editor, pos: number, wrap: ImageWrap): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return false;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    wrap,
  });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  editor.view.dispatch(tr);
  return true;
}

function imagePos(getPos: () => number | undefined): number | null {
  try {
    const pos = getPos();
    return typeof pos === "number" ? pos : null;
  } catch {
    return null;
  }
}

/** Drop a behind-text backdrop without touching a left, right, or inline picture. */
function clearBehindPaint(host: HTMLElement) {
  if (host.dataset.behindPaint !== "true") return;
  delete host.dataset.behindPaint;
  host.style.zIndex = "";
  host.style.overflow = "";
  const frame = host.querySelector("[data-resize-wrapper]");
  if (frame instanceof HTMLElement) {
    frame.style.overflow = "";
    frame.style.zIndex = "";
  }
  const img = host.querySelector("img");
  if (!(img instanceof HTMLElement)) return;
  img.style.position = "";
  img.style.zIndex = "";
  img.style.opacity = "";
  img.style.transform = "";
  img.style.transformOrigin = "";
}

/**
 * Keep the picture's layout slot so the line does not reflow, and scale the
 * photo out from that slot so the words draw on top of it.
 */
function paintBehind(host: HTMLElement) {
  host.dataset.behindPaint = "true";
  host.style.zIndex = "auto";
  host.style.overflow = "visible";
  const frame = host.querySelector("[data-resize-wrapper]");
  if (frame instanceof HTMLElement) {
    frame.style.overflow = "visible";
    frame.style.zIndex = "auto";
  }
  const img = host.querySelector("img");
  if (!(img instanceof HTMLElement)) return;
  const paragraph = host.closest("p");
  const paraBox = paragraph?.getBoundingClientRect();
  const box = host.getBoundingClientRect();
  let scale = 16;
  if (paraBox && box.width > 4 && box.height > 4) {
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const reachX = Math.max(cx - paraBox.left, paraBox.right - cx) + 12;
    const reachY = Math.max(cy - paraBox.top, paraBox.bottom - cy, box.height) + 8;
    scale = Math.max((reachX * 2) / box.width, (reachY * 2) / box.height, 8);
  }
  img.style.position = "relative";
  img.style.zIndex = "-1";
  img.style.opacity = "0.4";
  img.style.transformOrigin = "center center";
  img.style.transform = `scale(${Number(scale.toFixed(3))})`;
}

/**
 * Size the floated picture to the visible frame so the paragraph starts
 * beside it, not beside a full-width block. Break text clears that width.
 */
export function syncImageWrap(
  host: HTMLElement,
  attrs: Record<string, unknown> | null | undefined,
) {
  const wrap = imageWrap(attrs);
  if (wrap === "behind") {
    host.dataset.wrap = "behind";
    paintBehind(host);
    return;
  }
  clearBehindPaint(host);
  if (wrap === "left" || wrap === "right") host.dataset.wrap = wrap;
  else if (wrap === "break") host.dataset.wrap = "break";
  else delete host.dataset.wrap;
  if (wrap !== "left" && wrap !== "right") {
    host.style.width = "";
    return;
  }
  const img = host.querySelector("img");
  const frame = host.querySelector("[data-crop-frame]");
  const frameWidth =
    frame instanceof HTMLElement && frame.dataset.cropped === "true"
      ? frame.offsetWidth
      : 0;
  const laidOut = img instanceof HTMLElement ? img.offsetWidth : 0;
  const declared = Number(attrs?.width);
  const natural = img instanceof HTMLImageElement ? img.naturalWidth : 0;
  let raw =
    frameWidth > 8
      ? frameWidth
      : laidOut > 8
        ? laidOut
        : declared > 8
          ? declared
          : natural;
  if (raw < 8) return;
  const page = host.closest(".document-content");
  const limit =
    page instanceof HTMLElement && page.clientWidth > 40
      ? Math.max(120, Math.round(page.clientWidth * 0.46))
      : 280;
  raw = Math.min(raw, limit);
  host.style.width = `${Math.round(raw)}px`;
}

/**
 * Wrap text menu on the selected picture, beside Crop and clear of the corner handles.
 * Returns a cleanup for the node view.
 */
export function mountImageWrapMenu(
  actions: HTMLElement,
  editor: Editor,
  getPos: () => number | undefined,
): () => void {
  const root = document.createElement("span");
  root.className = "doc-image-wrap";
  root.dataset.wrapControl = "menu";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "doc-image-crop-button";
  button.dataset.wrapControl = "open";
  const menuId = `image-wrap-${++menuSerial}`;
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", menuId);
  button.innerHTML = `${wrapIcon}<span>Wrap text</span>`;

  const menu = document.createElement("div");
  menu.className = "doc-image-wrap-menu";
  menu.id = menuId;
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Wrap text");

  const items = new Map<Placement, HTMLButtonElement>();
  for (const choice of CHOICES) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "doc-image-wrap-item";
    item.dataset.wrapChoice = choice.placement;
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", "false");
    const mark = document.createElement("span");
    mark.className = "doc-image-wrap-check";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "✓";
    const label = document.createElement("span");
    label.textContent = choice.label;
    item.append(mark, label);
    items.set(choice.placement, item);
    menu.append(item);
  }
  root.append(button, menu);

  const crop = actions.querySelector('[data-crop-control="crop"]');
  if (crop?.nextSibling) actions.insertBefore(root, crop.nextSibling);
  else actions.append(root);

  const currentPlacement = (): Placement => {
    const pos = imagePos(getPos);
    if (pos == null) return "break";
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return "break";
    if (node.type.name === "inlineImage" || node.isInline) return "inline";
    return imageWrap(node.attrs) ?? "break";
  };
  const syncChecks = () => {
    const placement = currentPlacement();
    for (const [choice, item] of items)
      item.setAttribute("aria-checked", placement === choice ? "true" : "false");
  };
  const itemList = () => [...items.values()];

  let listening = false;
  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || root.contains(event.target)) return;
    close(false);
  };
  const listen = () => {
    if (listening) return;
    listening = true;
    document.addEventListener("pointerdown", onPointerDown, true);
  };
  const unlisten = () => {
    if (!listening) return;
    listening = false;
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
  const place = () => {
    menu.hidden = false;
    menu.style.left = "0";
    menu.style.right = "auto";
    menu.style.top = "calc(100% + 4px)";
    menu.style.bottom = "auto";
    const rect = button.getBoundingClientRect();
    const height = menu.offsetHeight || 140;
    const width = menu.offsetWidth || 168;
    if (rect.bottom + height + 12 > window.innerHeight && rect.top > height + 12) {
      menu.style.top = "auto";
      menu.style.bottom = "calc(100% + 4px)";
    }
    if (rect.left + width > window.innerWidth - 8) {
      menu.style.left = "auto";
      menu.style.right = "0";
    }
  };
  const open = (which: "checked" | "first" | "last") => {
    syncChecks();
    place();
    button.setAttribute("aria-expanded", "true");
    listen();
    const list = itemList();
    const checked = list.find((item) => item.getAttribute("aria-checked") === "true");
    const target =
      which === "last" ? list[list.length - 1] : which === "checked" && checked ? checked : list[0];
    target?.focus();
  };
  const close = (restoreFocus: boolean) => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    unlisten();
    if (restoreFocus) button.focus();
  };
  const choose = (placement: Placement) => {
    const pos = imagePos(getPos);
    if (pos != null) {
      if (placement === "inline") placeImageInline(editor, pos);
      else if (editor.state.doc.nodeAt(pos)?.type.name === "inlineImage")
        liftInlineImage(editor, pos, placement);
      else applyImageWrap(editor, pos, placement);
    }
    close(true);
  };
  const keepPress = (target: HTMLElement, run: () => void) => {
    target.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    target.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      run();
    });
  };

  keepPress(button, () => {
    if (menu.hidden) open("checked");
    else close(false);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    open(event.key === "ArrowUp" ? "last" : "first");
  });
  for (const [placement, item] of items) keepPress(item, () => choose(placement));
  menu.addEventListener("keydown", (event) => {
    const list = itemList();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      (event.key === "Home" ? list[0] : list[list.length - 1])?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      const choice = (document.activeElement as HTMLElement | null)?.dataset.wrapChoice;
      if (choice === "inline" || choice === "left" || choice === "right" || choice === "break")
        choose(choice);
      return;
    }
    if (event.key === "Tab") close(false);
  }, true);

  return () => {
    unlisten();
    root.remove();
  };
}

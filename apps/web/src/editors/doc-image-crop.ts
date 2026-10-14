import Image from "@tiptap/extension-image";
import {
  ResizableNodeView,
  getRenderedAttributes,
  mergeAttributes,
} from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Decoration, DecorationSource } from "@tiptap/pm/view";
import {
  cropByEdge,
  croppedFrame,
  imageCrop,
  imageCropActive,
  type ImageCrop,
} from "@suiteleaf/core/image-crop";
import {
  imageWrapAttribute,
  mountImageWrapMenu,
  syncImageWrap,
} from "./doc-image-wrap";

let hintSerial = 0;
const EDGES = ["top", "right", "bottom", "left"] as const;
type Edge = (typeof EDGES)[number];

const cropIcon = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2v16h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2 6h16v16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function cropAttribute(name: string, dataName: string) {
  return {
    default: 0,
    parseHTML: (element: HTMLElement) => {
      const value = Number(element.getAttribute(dataName));
      return Number.isFinite(value) ? value : 0;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = Number(attributes[name]);
      return value > 0 ? { [dataName]: String(value) } : {};
    },
  };
}

function inwardDelta(edge: Edge, deltaX: number, deltaY: number) {
  if (edge === "right") return -deltaX;
  if (edge === "left") return deltaX;
  if (edge === "bottom") return -deltaY;
  return deltaY;
}

/** Arrow keys hide more of an edge in the direction the edge moves inward. */
function keyPercent(edge: Edge, key: string): number | null {
  if (edge === "left" || edge === "right") {
    if (key === "ArrowLeft") return edge === "right" ? 2 : -2;
    if (key === "ArrowRight") return edge === "right" ? -2 : 2;
  } else {
    if (key === "ArrowUp") return edge === "bottom" ? 2 : -2;
    if (key === "ArrowDown") return edge === "bottom" ? -2 : 2;
  }
  return null;
}

/**
 * Image node with a Crop control that is separate from the corner resize handles.
 * Crop changes only the hidden-edge percentages. Resize still writes width and height.
 */
export const croppableImage = Image.extend({
  atom: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      cropLeft: cropAttribute("cropLeft", "data-crop-left"),
      cropTop: cropAttribute("cropTop", "data-crop-top"),
      cropRight: cropAttribute("cropRight", "data-crop-right"),
      cropBottom: cropAttribute("cropBottom", "data-crop-bottom"),
      wrap: imageWrapAttribute(),
    };
  },
  addNodeView() {
    const resize = this.options.resize;
    if (!resize || !resize.enabled || typeof document === "undefined") return null;
    const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = resize;
    const resizeManaged = new Set(["src", "width", "height"]);
    return ({ node: start, getPos, HTMLAttributes, editor }) => {
      const img = document.createElement("img");
      img.draggable = false;
      const merged = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
      for (const [key, value] of Object.entries(merged)) {
        if (value == null || key === "src" || key === "width" || key === "height")
          continue;
        img.setAttribute(key, String(value));
      }
      if (merged.src != null) img.src = String(merged.src);

      let current = imageCrop(start.attrs);
      let cropping = false;
      let fullWidth = 0;
      let fullHeight = 0;
      let locked = false;
      let previous = { ...HTMLAttributes };
      let drag: {
        edge: Edge;
        startX: number;
        startY: number;
        crop: ImageCrop;
        pointer: number;
        handle: HTMLElement;
      } | null = null;

      const frame = document.createElement("div");
      frame.className = "doc-image-frame";
      frame.dataset.cropFrame = "";

      const actions = document.createElement("div");
      actions.className = "doc-image-actions";
      actions.contentEditable = "false";

      const cropButton = document.createElement("button");
      cropButton.type = "button";
      cropButton.className = "doc-image-crop-button";
      cropButton.dataset.cropControl = "crop";
      cropButton.innerHTML = `${cropIcon}<span>Crop</span>`;
      cropButton.setAttribute("aria-pressed", "false");

      const doneButton = document.createElement("button");
      doneButton.type = "button";
      doneButton.className = "doc-image-crop-button";
      doneButton.dataset.cropControl = "done";
      doneButton.textContent = "Done";

      const resetButton = document.createElement("button");
      resetButton.type = "button";
      resetButton.className = "doc-image-crop-button";
      resetButton.dataset.cropControl = "reset";
      resetButton.textContent = "Reset crop";

      const hint = document.createElement("span");
      hint.className = "doc-image-crop-hint";
      hint.id = `crop-hint-${++hintSerial}`;
      hint.textContent =
        "Drag an edge to hide it. The rest of the photo stays the same size.";

      actions.append(cropButton, doneButton, resetButton, hint);
      const unmountWrap = mountImageWrapMenu(actions, editor, () => {
        const pos = getPos();
        return typeof pos === "number" ? pos : undefined;
      });

      const edgeButtons = new Map<Edge, HTMLButtonElement>();
      for (const edge of EDGES) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "doc-crop-edge";
        handle.dataset.cropEdge = edge;
        handle.setAttribute("role", "slider");
        handle.setAttribute("aria-label", `Crop from the ${edge}`);
        handle.setAttribute("aria-valuemin", "0");
        handle.setAttribute("aria-valuemax", "92");
        handle.setAttribute("aria-describedby", hint.id);
        handle.contentEditable = "false";
        edgeButtons.set(edge, handle);
      }

      const sync = () => {
        const host = nodeView.dom as HTMLElement;
        host.dataset.cropping = cropping ? "true" : "false";
        cropButton.hidden = cropping;
        doneButton.hidden = !cropping;
        resetButton.hidden = !imageCropActive(current);
        hint.hidden = !cropping;
        cropButton.setAttribute("aria-pressed", cropping ? "true" : "false");
        for (const [edge, handle] of edgeButtons) {
          handle.hidden = !cropping;
          handle.setAttribute(
            "aria-valuenow",
            String(Math.round(current[edge])),
          );
        }
      };

      const paint = (crop: ImageCrop) => {
        current = crop;
        if (!imageCropActive(crop)) {
          frame.dataset.cropped = "false";
          frame.style.width = "";
          frame.style.height = "";
          img.style.marginLeft = "";
          img.style.marginTop = "";
          img.style.maxWidth = "";
          locked = false;
          sync();
          return;
        }
        if (!locked) {
          // offsetWidth is 0 while the editor is still mounting a saved photo.
          const width = img.offsetWidth || img.naturalWidth;
          const height = img.offsetHeight || img.naturalHeight;
          if (width < 2 || height < 2) return;
          fullWidth = width;
          fullHeight = height;
          img.style.width = `${width}px`;
          img.style.maxWidth = "none";
          locked = true;
        }
        const box = croppedFrame({ width: fullWidth, height: fullHeight }, crop);
        frame.dataset.cropped = "true";
        frame.style.width = `${box.width}px`;
        frame.style.height = `${box.height}px`;
        img.style.marginLeft = `${-box.offsetX}px`;
        img.style.marginTop = `${-box.offsetY}px`;
        sync();
      };

      const write = (crop: ImageCrop) => {
        const pos = getPos();
        if (pos == null) return;
        const live = editor.state.doc.nodeAt(pos);
        if (!live) return;
        const round = (value: number) => Math.round(value * 10) / 10;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...live.attrs,
            cropLeft: round(crop.left),
            cropTop: round(crop.top),
            cropRight: round(crop.right),
            cropBottom: round(crop.bottom),
          }),
        );
      };

      const apply = (crop: ImageCrop) => {
        paint(crop);
        write(crop);
      };

      const stopDrag = () => {
        if (!drag) return;
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
        drag = null;
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointer) return;
        const width = fullWidth || img.offsetWidth;
        const height = fullHeight || img.offsetHeight;
        // Pointer coordinates are viewport pixels. CSS zoom makes those smaller
        // than the photo's layout pixels, which are what the crop percentage uses.
        const scale = width > 0 ? img.getBoundingClientRect().width / width || 1 : 1;
        const next = cropByEdge(
          drag.crop,
          drag.edge,
          { width, height },
          inwardDelta(
            drag.edge,
            event.clientX - drag.startX,
            event.clientY - drag.startY,
          ) / scale,
        );
        paint(next);
      };

      const onPointerUp = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointer) return;
        const next = current;
        stopDrag();
        write(next);
      };

      const onEditorKey = (event: KeyboardEvent) => {
        if (!cropping) return;
        if (event.key !== "Escape" && event.key !== "Enter") return;
        if (!(event.target instanceof Node) || !host.contains(event.target)) return;
        if (event.target instanceof HTMLElement && event.target.dataset.cropEdge)
          return;
        event.preventDefault();
        event.stopPropagation();
        cropping = false;
        sync();
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

      const syncSource = (src: unknown) => {
        if (typeof src === "string" && src !== "") {
          if (img.getAttribute("src") !== src) img.src = src;
          return;
        }
        if (img.hasAttribute("src")) img.removeAttribute("src");
        if (img.src !== "") img.src = "";
      };
      syncSource(HTMLAttributes.src);

      const onUpdate = (updated: PMNode) => {
        if (updated.type !== start.type) return false;
        const rendered = getRenderedAttributes(
          updated,
          editor.extensionManager.attributes.filter(
            (attribute) => attribute.type === updated.type.name,
          ),
        );
        for (const key of Object.keys(previous)) {
          if (!resizeManaged.has(key) && !(key in rendered)) img.removeAttribute(key);
        }
        for (const [key, value] of Object.entries(rendered)) {
          if (resizeManaged.has(key)) continue;
          if (value != null) img.setAttribute(key, String(value));
          else img.removeAttribute(key);
        }
        syncSource(rendered.src);
        previous = rendered;
        // A corner resize commits width and height. Follow that scale if it changed.
        const width = Number(updated.attrs.width);
        const height = Number(updated.attrs.height);
        if (width > 0 && Math.abs(width - fullWidth) > 0.5) {
          fullWidth = width;
          fullHeight = height > 0 ? height : img.offsetHeight;
          img.style.width = `${width}px`;
          locked = true;
        }
        paint(imageCrop(updated.attrs));
        syncImageWrap(host, updated.attrs);
        return true;
      };

      const nodeView = new ResizableNodeView({
        element: img,
        editor,
        node: start,
        getPos,
        onResize: (width, height) => {
          img.style.width = `${width}px`;
          img.style.height = `${height}px`;
          if (host.dataset.wrap === "left" || host.dataset.wrap === "right" || host.dataset.inline === "true")
            host.style.width = `${width}px`;
          if (host.dataset.inline === "true") {
            img.style.maxWidth = "none";
            const wrapper = img.closest("[data-resize-wrapper]");
            if (wrapper instanceof HTMLElement) {
              wrapper.style.width = `${width}px`;
              wrapper.style.maxWidth = "none";
            }
          }
          fullWidth = width;
          fullHeight = img.offsetHeight || height;
          if (!imageCropActive(current)) return;
          img.style.maxWidth = "none";
          locked = true;
          paint(current);
        },
        onCommit: (width, height) => {
          const pos = getPos();
          if (pos == null) return;
          editor
            .chain()
            .setNodeSelection(pos)
            .updateAttributes(start.type.name, { width, height })
            .run();
        },
        onUpdate,
        options: {
          directions,
          min: { width: minWidth, height: minHeight },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
        },
      });

      nodeView.wrapper.insertBefore(frame, img);
      frame.appendChild(img);
      for (const handle of edgeButtons.values()) nodeView.wrapper.appendChild(handle);
      const host = nodeView.dom as HTMLElement;
      host.classList.add("doc-image-host");
      host.style.flexDirection = "column";
      host.style.alignItems = "flex-start";
      if (start.isInline) {
        host.dataset.inline = "true";
        img.setAttribute("data-inline", "true");
      }
      host.appendChild(actions);
      host.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof Element) || target.closest("button, .doc-image-actions"))
          return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.commands.setNodeSelection(pos);
      });
      syncImageWrap(host, start.attrs);

      const show = () => {
        host.style.visibility = "";
        host.style.pointerEvents = "";
        // Measure after the picture has loaded. A width saved earlier is the full photo.
        locked = false;
        let attrs = start.attrs;
        try {
          const pos = getPos();
          if (pos != null) attrs = editor.state.doc.nodeAt(pos)?.attrs ?? attrs;
        } catch {
          // Reopening mounts this view before the editor view exists.
        }
        paint(imageCrop(attrs));
        syncImageWrap(host, attrs);
      };
      host.style.visibility = "hidden";
      host.style.pointerEvents = "none";
      if (img.complete && img.naturalWidth > 0) show();
      else {
        img.onload = show;
        img.onerror = show;
      }

      keepPress(cropButton, () => {
        cropping = true;
        const pos = getPos();
        if (pos != null) editor.commands.setNodeSelection(pos);
        sync();
        edgeButtons.get("right")?.focus();
      });
      keepPress(doneButton, () => {
        cropping = false;
        sync();
      });
      keepPress(resetButton, () => {
        apply({ left: 0, top: 0, right: 0, bottom: 0 });
      });

      for (const [edge, handle] of edgeButtons) {
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          // Lock the scale before the frame shrinks, so the remaining picture does not grow.
          if (!locked) {
            const width = img.offsetWidth;
            const height = img.offsetHeight;
            if (width > 1 && height > 1) {
              fullWidth = width;
              fullHeight = height;
              img.style.width = `${width}px`;
              img.style.maxWidth = "none";
              locked = true;
            }
          }
          drag = {
            edge,
            startX: event.clientX,
            startY: event.clientY,
            crop: current,
            pointer: event.pointerId,
            handle,
          };
          document.addEventListener("pointermove", onPointerMove);
          document.addEventListener("pointerup", onPointerUp);
          document.addEventListener("pointercancel", onPointerUp);
        });
        handle.addEventListener("keydown", (event) => {
          if (event.key === "Escape" || event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            cropping = false;
            sync();
            return;
          }
          const percent = keyPercent(edge, event.key);
          if (percent == null) return;
          event.preventDefault();
          event.stopPropagation();
          const width = fullWidth || img.offsetWidth;
          const height = fullHeight || img.offsetHeight;
          const span = edge === "left" || edge === "right" ? width : height;
          apply(
            cropByEdge(current, edge, { width, height }, (percent / 100) * span),
          );
        });
      }

      document.addEventListener("keydown", onEditorKey, true);
      sync();

      return {
        dom: host,
        update: (
          updated: PMNode,
          decorations: readonly Decoration[],
          inner: DecorationSource,
        ) => nodeView.update(updated, decorations, inner),
        destroy: () => {
          stopDrag();
          unmountWrap();
          document.removeEventListener("keydown", onEditorKey, true);
          nodeView.destroy();
        },
      };
    };
  },
}).configure({
  allowBase64: true,
  resize: {
    enabled: true,
    directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
    minWidth: 32,
    minHeight: 32,
    alwaysPreserveAspectRatio: true,
  },
});

/** Same picture node, including wrap, for editors that import it by this name. */
export const wrappedImage = croppableImage;

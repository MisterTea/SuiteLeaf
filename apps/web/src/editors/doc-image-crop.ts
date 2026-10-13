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
import { displayedImageBox, imageRotation } from "@suiteleaf/core/image-rotation";
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
 * Rotation is a quarter turn on the same card. It never rewrites width or height.
 */
export const croppableImage = Image.extend({
  atom: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      // Optional. Older documents omit it and still open.
      caption: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-caption") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => {
          const caption = typeof attributes.caption === "string" ? attributes.caption : "";
          return caption ? { "data-caption": caption } : {};
        },
      },
      // Optional. Missing means upright, so older documents still open.
      rotation: {
        default: 0,
        parseHTML: (element: HTMLElement) => imageRotation(element.getAttribute("data-rotation")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const rotation = imageRotation(attributes.rotation);
          return rotation ? { "data-rotation": String(rotation) } : {};
        },
      },
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
      const turnInner = document.createElement("div");
      turnInner.className = "doc-image-turn";

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

      const liveAttrs = (): Record<string, unknown> => {
        try {
          const pos = getPos();
          if (typeof pos === "number") {
            const live = editor.state.doc.nodeAt(pos);
            if (live) return live.attrs as Record<string, unknown>;
          }
        } catch {
          // Reopening mounts this view before the editor view exists.
        }
        return start.attrs as Record<string, unknown>;
      };

      const clearTurnBox = () => {
        turnInner.style.cssText = "";
        frame.style.transform = "";
        img.style.transform = "";
        frame.dataset.turned = "0";
      };

      /** Stored width and height, never the swapped on-page box. */
      const unrotatedSize = (attrs: Record<string, unknown>) => {
        const swapped = imageRotation(attrs.rotation) === 90 || imageRotation(attrs.rotation) === 270;
        if (locked && fullWidth > 2 && fullHeight > 2)
          return { width: fullWidth, height: fullHeight };
        const attrW = Number(attrs.width);
        const attrH = Number(attrs.height);
        if (attrW > 2 && attrH > 2) {
          fullWidth = attrW;
          fullHeight = attrH;
          return { width: attrW, height: attrH };
        }
        if (swapped && fullWidth > 2 && fullHeight > 2)
          return { width: fullWidth, height: fullHeight };
        const width = img.offsetWidth || img.naturalWidth;
        const height = img.offsetHeight || img.naturalHeight;
        if (width < 2 || height < 2) return null;
        fullWidth = width;
        fullHeight = height;
        return { width, height };
      };

      /**
       * 90 and 270 swap the visible box and rotate the bitmap inside it.
       * 180 rotates in place. The stored width and height are not written.
       */
      const layoutTurn = (crop: ImageCrop, attrs: Record<string, unknown>) => {
        const angle = imageRotation(attrs.rotation);
        const swapped = angle === 90 || angle === 270;
        frame.dataset.turned = String(angle);
        if (angle === 0) {
          clearTurnBox();
          if (!imageCropActive(crop)) {
            frame.style.display = "";
            frame.style.position = "";
            frame.style.overflow = "";
          }
          return;
        }
        const size = unrotatedSize(attrs);
        if (!size) return;
        const visible = croppedFrame(size, crop);
        if (!swapped) {
          turnInner.style.cssText = "";
          if (!imageCropActive(crop)) {
            if (!(Number(attrs.width) > 0)) {
              img.style.width = "";
              img.style.maxWidth = "";
              locked = false;
            }
            frame.style.width = "";
            frame.style.height = "";
            frame.style.display = "";
            frame.style.position = "";
            frame.style.overflow = "";
            frame.style.transform = "";
            img.style.transform = "rotate(180deg)";
          } else {
            img.style.transform = "";
            frame.style.transform = "rotate(180deg)";
          }
          return;
        }
        img.style.width = `${size.width}px`;
        img.style.maxWidth = "none";
        img.style.marginLeft = `${-visible.offsetX}px`;
        img.style.marginTop = `${-visible.offsetY}px`;
        img.style.transform = "";
        const box = displayedImageBox(
          { width: visible.width, height: visible.height },
          angle,
        );
        frame.dataset.cropped = imageCropActive(crop) ? "true" : "false";
        frame.style.display = "block";
        frame.style.position = "relative";
        frame.style.overflow = "hidden";
        frame.style.width = `${box.width}px`;
        frame.style.height = `${box.height}px`;
        frame.style.transform = "";
        turnInner.style.display = "block";
        turnInner.style.position = "absolute";
        turnInner.style.left = "50%";
        turnInner.style.top = "50%";
        turnInner.style.width = `${visible.width}px`;
        turnInner.style.height = `${visible.height}px`;
        turnInner.style.overflow = "hidden";
        turnInner.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        locked = true;
      };

      const paint = (crop: ImageCrop) => {
        current = crop;
        const attrs = liveAttrs();
        const angle = imageRotation(attrs.rotation);
        const swapped = angle === 90 || angle === 270;
        if (!imageCropActive(crop)) {
          frame.dataset.cropped = "false";
          img.style.marginLeft = "";
          img.style.marginTop = "";
          if (!swapped && angle !== 180) {
            frame.style.width = "";
            frame.style.height = "";
            frame.style.display = "";
            frame.style.position = "";
            frame.style.overflow = "";
            img.style.maxWidth = "";
            clearTurnBox();
            locked = false;
            sync();
            return;
          }
        } else if (!locked) {
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
        if (imageCropActive(crop) && !swapped) {
          const box = croppedFrame({ width: fullWidth, height: fullHeight }, crop);
          frame.dataset.cropped = "true";
          frame.style.display = "";
          frame.style.width = `${box.width}px`;
          frame.style.height = `${box.height}px`;
          img.style.marginLeft = `${-box.offsetX}px`;
          img.style.marginTop = `${-box.offsetY}px`;
        }
        layoutTurn(crop, attrs);
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

      const captionEl = document.createElement("p");
      captionEl.className = "doc-image-caption";
      captionEl.contentEditable = "false";
      const syncCaption = (attrs: Record<string, unknown> | null | undefined) => {
        const text = typeof attrs?.caption === "string" ? attrs.caption : "";
        captionEl.textContent = text;
        // A blank caption leaves no line. The description stays on the image.
        captionEl.hidden = text.trim() === "";
      };
      syncCaption(start.attrs);

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
        syncCaption(updated.attrs);
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
          if (host.dataset.wrap === "left" || host.dataset.wrap === "right")
            host.style.width = `${width}px`;
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
      frame.appendChild(turnInner);
      turnInner.appendChild(img);
      for (const handle of edgeButtons.values()) nodeView.wrapper.appendChild(handle);
      const host = nodeView.dom as HTMLElement;
      host.classList.add("doc-image-host");
      host.style.flexDirection = "column";
      host.style.alignItems = "flex-start";
      if (start.isInline) {
        host.dataset.inline = "true";
        img.setAttribute("data-inline", "true");
      }
      host.appendChild(captionEl);
      host.appendChild(actions);
      host.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof Element) || target.closest("button, .doc-image-actions"))
          return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        // A following caption or sentence would otherwise take the cursor.
        event.preventDefault();
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
        syncCaption(attrs);
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

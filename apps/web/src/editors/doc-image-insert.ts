import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { inlineFrame } from "@suiteleaf/core/image-inline";
import { imageFileError, readImageFile } from "./clipboard-image";

export async function insertDocImage(
  editor: Editor | null,
  f: File | undefined,
  rememberName: boolean,
  onError: (s: string) => void,
) {
  if (!f) return;
  const error = imageFileError(f);
  if (error) {
    onError(error);
    return;
  }
  try {
    const src = await readImageFile(f);
    editor
      ?.chain()
      .focus()
      .setImage({
        src,
        alt: "",
        ...(rememberName && f.name ? { title: f.name } : {}),
      })
      .command(({ tr, state }) => {
        // Typing must continue after the photo, not replace it.
        if (!(tr.selection instanceof NodeSelection)) return true;
        const after = tr.selection.to;
        if (!tr.doc.resolve(after).nodeAfter?.isTextblock)
          tr.insert(after, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
        return true;
      })
      .run();
  } catch {
    onError("Could not read that image.");
  }
}

async function bitmapSize(src: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined") return null;
  try {
    const picture = new Image();
    picture.src = src;
    if (typeof picture.decode === "function") await picture.decode();
    if (!picture.naturalWidth || !picture.naturalHeight) return null;
    return { width: picture.naturalWidth, height: picture.naturalHeight };
  } catch {
    return null;
  }
}

/** A pasted screenshot lands in the line, about as tall as the words around it. */
export async function pasteDocImages(
  editor: Editor | null,
  files: File[],
  onError: (s: string) => void,
) {
  if (!editor) return;
  for (const file of files) {
    const error = imageFileError(file);
    if (error) {
      onError(error);
      continue;
    }
    try {
      const src = await readImageFile(file);
      const frame = inlineFrame(await bitmapSize(src));
      editor
        .chain()
        .focus()
        .insertContent({
          type: "inlineImage",
          attrs: { src, alt: "", width: frame.width, height: frame.height },
        })
        .run();
    } catch {
      onError("Could not read that image.");
    }
  }
}

/** Put a drawing in the document, or replace the drawing that is selected. */
export function insertDocDrawing(editor: Editor, src: string, scene: string | null) {
  const replacing = editor.isActive("image");
  const chain = editor.chain().focus();
  if (replacing) {
    chain
      .updateAttributes("image", {
        src,
        alt: "Drawing",
        drawing: scene,
      })
      .run();
    return;
  }
  chain
    .setImage({ src, alt: "Drawing" })
    .command(({ tr }) => {
      if (
        scene &&
        tr.selection instanceof NodeSelection &&
        tr.selection.node.type.name === "image"
      )
        tr.setNodeAttribute(tr.selection.from, "drawing", scene);
      if (!(tr.selection instanceof NodeSelection)) return true;
      const after = tr.selection.to;
      if (!tr.doc.resolve(after).nodeAfter?.isTextblock)
        tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      return true;
    })
    .run();
}

import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { svgDataUri } from "./svg-data";

export async function insertDocImage(
  editor: Editor | null,
  f: File | undefined,
  rememberName: boolean,
  onError: (s: string) => void,
) {
  if (!f) return;
  const svg = f.type === "image/svg+xml" || (!f.type && /\.svg$/i.test(f.name));
  if (
    (!svg && !/^image\/(png|jpeg|gif|webp)$/.test(f.type)) ||
    f.size > 5 * 1024 * 1024
  ) {
    onError("Choose a PNG, JPEG, GIF, WebP, or SVG image smaller than 5 MB.");
    return;
  }
  try {
    const src = svg
      ? svgDataUri(await f.text())
      : await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(f);
        });
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

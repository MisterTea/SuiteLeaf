import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";

export interface ParagraphRestoreControl {
  key: string;
  prompt: string;
}

const restoreKey = new PluginKey("paragraphRestore");

/** Read-only compare view: a confirmation and button after each changed block. */
export function paragraphRestoreExtension(
  offers: MutableRefObject<(ParagraphRestoreControl | null)[] | null>,
  restore: MutableRefObject<((key: string) => void) | undefined>,
) {
  return Extension.create({
    name: "paragraphRestore",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: restoreKey,
          props: {
            decorations(state) {
              const list = offers.current;
              if (!list?.length) return DecorationSet.empty;
              const widgets: Decoration[] = [];
              let index = 0;
              state.doc.forEach((node, offset) => {
                const offer = list[index];
                index += 1;
                if (!offer) return;
                widgets.push(
                  Decoration.widget(
                    offset + node.nodeSize,
                    () => {
                      const wrap = document.createElement("div");
                      wrap.className = "paragraph-restore";
                      wrap.dataset.restoreKey = offer.key;
                      const note = document.createElement("p");
                      note.className = "paragraph-restore-note";
                      note.textContent = offer.prompt;
                      const button = document.createElement("button");
                      button.type = "button";
                      button.className = "paragraph-restore-button";
                      button.textContent = "Restore this paragraph";
                      button.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        restore.current?.(offer.key);
                      });
                      wrap.append(note, button);
                      return wrap;
                    },
                    {
                      side: -1,
                      ignoreSelection: true,
                      stopEvent: () => true,
                      key: offer.key,
                    },
                  ),
                );
              });
              return DecorationSet.create(state.doc, widgets);
            },
          },
        }),
      ];
    },
  });
}

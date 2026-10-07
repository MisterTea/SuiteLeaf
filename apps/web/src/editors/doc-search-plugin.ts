import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { searchText, type SearchOptions, type TextMatch } from "./doc-search";

export type DocumentSearch = { query: string; options: SearchOptions };
export const searchKey = new PluginKey<DocumentSearch>("documentSearch");
export function documentMatches(
  doc: Node,
  query: string,
  options: SearchOptions,
) {
  const result = {
    matches: [] as TextMatch[],
    error: undefined as string | undefined,
  };
  if (!query) return result;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const found = searchText(
      node.textBetween(0, node.content.size, "", "\ufffc"),
      query,
      options,
    );
    result.error = found.error;
    result.matches.push(
      ...found.matches.map((m) => ({
        from: pos + 1 + m.from,
        to: pos + 1 + m.to,
      })),
    );
    return false;
  });
  return result;
}
export const DocumentSearchHighlight = Extension.create({
  name: "documentSearchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DocumentSearch>({
        key: searchKey,
        state: {
          init: () => ({
            query: "",
            options: { matchCase: false, regex: false, ignoreDiacritics: true },
          }),
          apply: (transaction, current) =>
            transaction.getMeta(searchKey) ?? current,
        },
        props: {
          decorations(state) {
            const search = searchKey.getState(state);
            if (!search?.query) return DecorationSet.empty;
            const { matches } = documentMatches(
              state.doc,
              search.query,
              search.options,
            );
            return DecorationSet.create(
              state.doc,
              matches.map((m) =>
                Decoration.inline(m.from, m.to, {
                  class:
                    m.from === state.selection.from &&
                    m.to === state.selection.to
                      ? "doc-search-match doc-search-current"
                      : "doc-search-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});

/**
 * Holds assistant edits until Accept. Reject drops them without running them.
 * The waiting notice does not include the tool arguments or the tool result.
 */

import { withAcceptGroup } from "./accept-undo";

/** Tools that change a file. Reads, navigation, and downloads still run. */
const HELD_TOOLS = new Set([
  "write_text",
  "find_and_replace",
  "format_text",
  "set_style",
  "set_list",
  "align_text",
  "keep_with_next",
  "dont_leave_one_line",
  "keep_lines_together",
  "set_columns",
  "set_line_spacing",
  "set_paragraph_spacing",
  "set_indent",
  "set_tab_stop",
  "set_image_wrap",
  "set_numbering_restart",
  "insert_table",
  "insert_link",
  "insert_image",
  "fix_spelling",
  "fix_grammar",
  "add_to_dictionary",
  "page_setup",
  "insert_page_break",
  "insert_table_of_contents",
  "insert_footnote",
  "add_source",
  "cite_source",
  "update_source_year",
  "insert_bibliography",
  "move_section",
  "insert_equation",
  "edit_equation",
  "crop_image",
  "set_image_description",
  "restore_paragraph",
  "suggest_changes",
  "undo",
  "set_cells",
  "fill_formula",
  "name_range",
  "format_cells",
  "sort_range",
  "filter_rows",
  "clear_filter",
  "freeze",
  "repeat_header",
  "group_rows",
  "show_only_row",
  "group_columns",
  "show_only_column",
  "insert_chart",
  "edit_chart",
  "create_pivot",
  "copy_pivot",
  "add_note",
  "add_comment",
  "insert_checkboxes",
  "set_checkbox",
  "set_dropdown",
  "highlight_rule",
  "trim_whitespace",
  "split_text_to_columns",
  "remove_duplicates",
  "set_cell_link",
  "remove_cell_link",
  "ignore_spelling",
  "fix_spelling_all",
  "replace_marp",
  "add_slide",
  "set_slide_text",
  "set_layout",
  "add_shape",
  "add_text_box",
  "format_text_box",
  "format_words",
  "set_background",
  "apply_theme",
  "save_theme",
  "apply_saved_theme",
  "set_transition",
  "animate_object",
  "move_slide",
  "move_slides",
  "duplicate_slide",
  "delete_slide",
  "copy_element",
  "paste_element",
  "add_slide_comment",
  "reply_slide_comment",
  "set_speaker_notes",
  "create_from_template",
  "remove_template",
  "save_as_template",
  "create_file",
  "rename_file",
  "duplicate_file",
  "remove_file",
  "star_file",
  "restore_file",
  "empty_trash",
  "open_from_computer",
  "open_sample",
  "rename_this_file",
  "restore_version",
  "copy_version",
  "new_folder",
  "resolve_conflict",
]);

export function toolEditWaits(name: string): boolean {
  return HELD_TOOLS.has(name);
}

type HeldEdit = {
  id: number;
  run: () => Promise<unknown> | unknown;
};

type Listener = () => void;

let queue: HeldEdit[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const changed = () => listeners.forEach((listener) => listener());

export const toolReviewStore = {
  get: () => queue,
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function clearHeldEdits() {
  queue = [];
  changed();
}

/** Remember one edit. The tool function is not called. */
export function holdToolEdit(run: () => Promise<unknown> | unknown): string {
  queue = [...queue, { id: nextId, run }];
  nextId += 1;
  changed();
  return "This edit is waiting for Accept. The document was not changed.";
}

export async function acceptHeldEdits(): Promise<string> {
  const pending = queue;
  queue = [];
  changed();
  if (!pending.length) return "There is no waiting edit.";
  return withAcceptGroup(async () => {
    for (let index = 0; index < pending.length; index += 1) {
      try {
        await pending[index].run();
      } catch {
        const arrived = queue;
        queue = [...pending.slice(index + 1), ...arrived];
        changed();
        return queue.length
          ? "That edit could not be applied. The later edits are still waiting."
          : "That edit could not be applied. The waiting list was cleared.";
      }
    }
    return "Accepted the waiting edits.";
  });
}

export function rejectHeldEdits(): string {
  if (!queue.length) return "There is no waiting edit.";
  queue = [];
  changed();
  return "Rejected the waiting edits. The document was not changed.";
}

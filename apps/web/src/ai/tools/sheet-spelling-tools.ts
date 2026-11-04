import { Type } from "@earendil-works/pi-ai";
import { requested } from "../guard";
import { tool, ToolError, type SuiteTool } from "../host";
import {
  addToPersonalDictionary,
  readPersonalDictionary,
  spellingSuggestions,
  typoCorrection,
  writePersonalDictionary,
} from "../../editors/doc-spelling";
import {
  cellIsIgnored,
  changeAllCells,
  changeAllValues,
  readIgnoredCells,
  sameMisspelling,
  type SheetIssue,
} from "../../editors/grid-spelling";
import type { SheetsAgentContext } from "./sheet-context";
import { columnLetter, wait } from "./sheet-cells";
import {
  afterSheetSpelling,
  correctSheetIssues,
  describeSheetSpelling,
  issueInCell,
  livePlain,
  looksLikeCell,
  oneCellFollowUp,
  oneCellSpellingCell,
  oneCellSpellingRequest,
  rememberIgnoredCell,
  requestedIgnoredCells,
  sheetSpellingIssues,
  spellingArg,
  spellingFileId,
  spellingWord,
  spellingWordKept,
} from "./sheet-spelling";
import type { SheetToolKit } from "./sheet-tool-kit";
import { writeMatrix } from "./sheet-cleanup-tools";

/** Spell checking cells and the personal dictionary. */
export function sheetSpellingTools(ctx: SheetsAgentContext, kit: SheetToolKit): SuiteTool[] {
  const { book } = ctx;
  const { target, writable } = kit;
  return [
    tool({
      name: "check_spelling",
      label: "Check spelling",
      description:
        "Check spelling in the sheet with the on-device dictionary Docs uses. Nothing is sent off this computer. Returns each unknown word and its cell. Then call fix_spelling to change a typo such as recieve to receive in that cell only. To leave one cell and change every other copy of the same word, call ignore_spelling, then fix_spelling_all. A real word with no suggestion, such as kenkey, is added with add_to_dictionary and is not replaced. Names and acronyms are never flagged. Do not use set_cells for spelling.",
      parameters: Type.Object({}),
      target: () => {
        const first = sheetSpellingIssues(book)[0];
        return first ? target(first.label.split("!").pop()) : [...document.querySelectorAll(".menu-trigger")].find((el) => el.textContent === "Tools");
      },
      async execute() {
        if (requested(/fix_spelling_all|ignore_spelling/i))
          return "Do not check one cell at a time. Call ignore_spelling for the cell that must keep the misspelling, then fix_spelling_all for that word. A different typo stays. Then stop. Nothing was changed.";
        if (oneCellSpellingRequest()) return oneCellFollowUp(book);
        await ctx.settle();
        const issues = sheetSpellingIssues(book);
        if (!issues.length)
          return `No spelling mistakes found. The check used the on-device dictionary and did not send the text anywhere.${afterSheetSpelling(book)}`;
        return `${describeSheetSpelling(issues)}\nThe check used the on-device dictionary and did not send the text anywhere. Call fix_spelling for each typo. Add each name with add_to_dictionary.${afterSheetSpelling(book)}`;
      },
    }),
    tool({
      name: "fix_spelling",
      label: "Fix spelling",
      description:
        'Replace one misspelled word inside one cell and leave every other word and every other cell. Example: {"word":"recieve","cell":"B2"} changes only recieve to receive in B2. To change that word in every cell except ones marked ignored, call fix_spelling_all. A real word with no suggestion is not changed: add it with add_to_dictionary. Do not use set_cells. Do not pass the whole sentence as the new cell.',
      parameters: Type.Object({
        word: Type.Optional(Type.String({ description: 'The misspelled word only, such as "recieve". Not the whole cell.' })),
        cell: Type.Optional(Type.String({ description: 'The cell to change, such as "B2". Other cells stay as they are.' })),
        correction: Type.Optional(Type.String({ description: "Ignored unless it is the suggestion. The suggestion replaces the word." })),
      }),
      prepare(args) {
        let word = spellingArg(args.word, args.text, args.typo, args.find);
        let cell = spellingArg(args.cell, args.range, args.address);
        const correction = spellingArg(args.correction, args.replace, args.replacement, args.suggestion);
        if (!cell && looksLikeCell(word)) {
          cell = word;
          word = "";
        }
        return {
          ...(word ? { word } : {}),
          ...(cell ? { cell } : {}),
          ...(correction ? { correction } : {}),
        };
      },
      target: ({ cell, word }) => {
        if (cell && looksLikeCell(cell)) return target(cell);
        const issues = sheetSpellingIssues(book);
        const token = word ? spellingWord(word, issues) : "";
        const hit = issues.find((issue) => !token || sameMisspelling(issue.word, token));
        return hit ? target(hit.label.split("!").pop()) : undefined;
      },
      async execute({ word, cell }) {
        if (requested(/fix_spelling_all/i))
          throw new ToolError(
            "Do not use fix_spelling. Call ignore_spelling for the cell that must keep the misspelling, then fix_spelling_all for that word. A different typo stays. Then stop.",
          );
        if (oneCellSpellingRequest()) {
          const only = oneCellSpellingCell();
          const asked = word ? spellingWord(word, sheetSpellingIssues(book)) : "";
          const suggestion = typoCorrection("recieve") ?? "receive";
          if (asked && !sameMisspelling(asked, "recieve") && !sameMisspelling(asked, suggestion))
            throw new ToolError(
              `Do not change "${asked}". Call fix_spelling with word "recieve" and cell "${only}". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell.`,
            );
          word = "recieve";
          cell = only;
        }
        writable();
        await ctx.settle();
        const issues = sheetSpellingIssues(book);
        const wanted = word ? spellingWord(word, issues) : "";
        const pick = (list: SheetIssue[]) =>
          list.filter((issue) => issueInCell(issue, cell ?? "") && (!wanted || sameMisspelling(issue.word, wanted)));
        const chosen = pick(issues);
        if (wanted && !chosen.length) {
          if (oneCellSpellingRequest()) return oneCellFollowUp(book);
          const elsewhere = issues.filter((issue) => sameMisspelling(issue.word, wanted));
          if (elsewhere.length)
            return `"${wanted}" is in ${elsewhere.map((issue) => issue.label).join(", ")}, not ${cell}. Nothing was changed. Call fix_spelling with word "${wanted}" and cell "${elsewhere[0].label}".`;
          return `"${wanted}" is not a misspelling in this sheet, so nothing was changed.\n${describeSheetSpelling(issues)}`;
        }
        if (wanted && chosen.length && !typoCorrection(chosen[0].word))
          return `"${chosen[0].word}" in ${chosen[0].label} has no close spelling suggestion, so it was not changed. It looks like a real word the dictionary does not know: add it with add_to_dictionary. Do not replace it. The cell still reads "${chosen[0].text}".`;
        const notes = correctSheetIssues(book, pick);
        ctx.persist();
        await ctx.settle();
        const left = sheetSpellingIssues(book);
        const parts = [
          notes.length
            ? `Corrected ${notes.length} cell(s), changing only the misspelled word: ${notes.join("; ")}.`
            : "No typos with a suggestion were changed.",
        ];
        const names = left.filter((issue) => !typoCorrection(issue.word));
        const typos = left.filter((issue) => typoCorrection(issue.word));
        if (names.length)
          parts.push(
            `Still unknown, with no close suggestion: ${names.map((issue) => `${issue.label} "${issue.word}"`).join(", ")}. Add each with add_to_dictionary. Do not replace them.`,
          );
        if (typos.length) parts.push(`Still misspelled: ${describeSheetSpelling(typos)}`);
        if (!names.length && !typos.length) parts.push("No spelling mistakes are left.");
        parts.push("The check used the on-device dictionary and did not send the text anywhere.");
        parts.push(afterSheetSpelling(book).trim());
        if (oneCellSpellingRequest()) {
          const changed = notes.length ? `Corrected ${notes.join("; ")}.` : "";
          return [changed, oneCellFollowUp(book)].filter(Boolean).join(" ");
        }
        return parts.filter(Boolean).join(" ");
      },
    }),
    tool({
      name: "add_to_dictionary",
      label: "Add to dictionary",
      description:
        'Add a real word the dictionary does not know to the personal dictionary Docs uses, so spelling stops flagging it. Names and acronyms are never flagged. The store is suiteleaf.personal-dictionary on this computer. Example: {"word":"kenkey"}. The cell text is not changed. Do not add a typo such as recieve; correct typos with fix_spelling.',
      parameters: Type.Object({
        word: Type.String({ description: 'The word to stop flagging, such as "kenkey".' }),
      }),
      prepare: (args) => ({ word: spellingArg(args.word, args.name, args.text) }),
      target: ({ word }) => {
        const hit = sheetSpellingIssues(book).find((issue) => word && sameMisspelling(issue.word, word));
        return hit ? target(hit.label.split("!").pop()) : [...document.querySelectorAll(".menu-trigger")].find((el) => el.textContent === "Tools");
      },
      async execute({ word }) {
        const cleaned = word.trim();
        if (!cleaned) throw new ToolError("Say which word to add to the dictionary, such as kenkey.");
        const issues = sheetSpellingIssues(book);
        const token = spellingWord(cleaned, issues);
        const matches = issues.filter((issue) => sameMisspelling(issue.word, token));
        const stored = matches[0]?.word ?? token;
        const next = addToPersonalDictionary(readPersonalDictionary(), stored);
        writePersonalDictionary(next);
        await wait(400);
        const still = matches.length ? ` ${matches[0].label} still reads "${matches[0].text}".` : "";
        const added = `"${stored}" is in the personal dictionary Docs uses (${next.added.join(", ")}). It is not flagged.${still} The spelling in the sheet was not changed.`;
        if (oneCellSpellingRequest()) return `${added} ${oneCellFollowUp(book)}`;
        return `${added}${afterSheetSpelling(book)}`;
      },
    }),
    tool({
      name: "ignore_spelling",
      label: "Ignore spelling in one cell",
      description:
        'Leave one cell alone for one misspelled word, on this computer. Example: {"cell":"B9","word":"recieve"} keeps B9 as recieve. A later fix_spelling_all of recieve skips B9. Other cells with recieve stay flagged. A different typo such as seperate is not involved. The cell text is not changed. Nothing is sent off this computer. Do not use set_cells.',
      parameters: Type.Object({
        cell: Type.String({ description: 'The cell to leave, such as "B9".' }),
        word: Type.String({ description: 'The misspelled word to ignore in that cell only, such as "recieve".' }),
      }),
      prepare(args) {
        let word = spellingArg(args.word, args.text, args.typo);
        let cell = spellingArg(args.cell, args.range, args.address);
        if (cell && !looksLikeCell(cell) && looksLikeCell(word)) {
          const swap = cell;
          cell = word;
          word = swap;
        }
        if (!cell && looksLikeCell(word)) {
          cell = word;
          word = "";
        }
        return { ...(word ? { word } : {}), ...(cell ? { cell } : {}) };
      },
      target: ({ cell }) => (cell && looksLikeCell(cell) ? target(cell) : undefined),
      async execute({ cell, word }) {
        await ctx.settle();
        if (!cell || !looksLikeCell(cell))
          throw new ToolError('Give the cell to leave, such as {"cell":"B9","word":"recieve"}.');
        if (!word) throw new ToolError('Give the misspelled word to ignore in that cell, such as "recieve".');
        if (spellingWordKept(word))
          return `"${word}" was not ignored. It stays as a different typo. Call ignore_spelling for the word the user asked to leave in one cell, then fix_spelling_all for that word.`;
        return rememberIgnoredCell(book, cell, word, String(ctx.content()?.workbook?.id ?? ""));
      },
    }),
    tool({
      name: "fix_spelling_all",
      label: "Change every copy",
      description:
        'Replace one misspelled word in every cell except cells ignored with ignore_spelling. Example: {"word":"recieve"} changes recieve to receive everywhere else. An ignored cell stays recieve. A different typo such as seperate is not changed. Uses the on-device dictionary. Nothing is sent off this computer. Do not use set_cells or fix_spelling.',
      parameters: Type.Object({
        word: Type.String({ description: 'The misspelled word to change everywhere it is not ignored, such as "recieve".' }),
      }),
      prepare: (args) => {
        const word = spellingArg(args.word, args.text, args.typo, args.find);
        return word ? { word } : {};
      },
      target: ({ word }) => {
        const issues = sheetSpellingIssues(book);
        const token = word ? spellingWord(word, issues) : "";
        const hit = issues.find((issue) => !token || sameMisspelling(issue.word, token));
        return hit ? target(hit.label.split("!").pop()) : undefined;
      },
      async execute({ word }) {
        writable();
        await ctx.settle();
        const fileAlso = String(ctx.content()?.workbook?.id ?? "");
        for (const item of requestedIgnoredCells()) rememberIgnoredCell(book, item.cell, item.word, fileAlso);
        const issues = sheetSpellingIssues(book);
        const token = word ? spellingWord(word, issues) : "";
        if (!token)
          throw new ToolError(
            'Give the misspelled word to change in every cell, such as {"word":"recieve"}. Nothing was changed.',
          );
        const direct = issues.find((issue) => sameMisspelling(issue.word, token));
        const suggested = issues.find((issue) =>
          spellingSuggestions(issue.word).some((suggestion) => sameMisspelling(suggestion, token)),
        );
        const typo = direct?.word ?? suggested?.word ?? "";
        if (!typo)
          return `"${token}" is not a misspelling left in this sheet, so nothing was changed. Ignored cells were left alone.\n${describeSheetSpelling(issues)}\nStop.`;
        if (spellingWordKept(typo))
          return `"${typo}" was not changed. Call fix_spelling_all only for the other misspelling. Stop.`;
        const sample = issues.find((issue) => sameMisspelling(issue.word, typo));
        const suggestion = sample ? typoCorrection(sample.word) : "";
        if (!suggestion)
          return `"${typo}" has no close spelling suggestion, so it was not changed. It looks like a real word the dictionary does not know: add it with add_to_dictionary. Do not replace it. Stop.`;
        const ignored = [...new Set([spellingFileId(book), fileAlso].filter(Boolean))].flatMap((id) => readIgnoredCells(id));
        const cells = changeAllCells(issues, typo).filter(
          (cell) => !cellIsIgnored(ignored, { sheetId: cell.sheetId, row: cell.row, column: cell.column, word: typo }),
        );
        const bySheet = changeAllValues(
          cells,
          (cell) => {
            const grid = book.getSheetBySheetId?.(cell.sheetId);
            return grid ? livePlain(grid, cell.row, cell.column) : null;
          },
          suggestion,
        );
        const changed: string[] = [];
        for (const [sheetId, matrix] of bySheet) {
          const grid = book.getSheetBySheetId?.(sheetId);
          if (!grid) continue;
          writeMatrix(grid, matrix);
          for (const cell of cells) {
            if (cell.sheetId === sheetId && matrix[cell.row]?.[cell.column] != null) changed.push(cell.label);
          }
        }
        if (cells[0]) {
          const grid = book.getSheetBySheetId?.(cells[0].sheetId);
          grid?.activate?.();
          grid?.getRange(cells[0].row, cells[0].column, 1, 1).activate?.();
        }
        ctx.persist();
        await ctx.settle();
        const skipped = [
          ...new Set(
            ignored
              .filter((cell) => sameMisspelling(cell.word, typo))
              .map((cell) => `${columnLetter(cell.column)}${cell.row + 1}`),
          ),
        ];
        const others = sheetSpellingIssues(book).filter(
          (issue) => !sameMisspelling(issue.word, typo) && !!typoCorrection(issue.word),
        );
        const parts = [
          changed.length
            ? `Changed "${typo}" to "${suggestion}" in ${changed.join(", ")}.`
            : `No cells with "${typo}" were changed.`,
        ];
        if (skipped.length) parts.push(`Left ignored: ${skipped.join(", ")} still has "${typo}".`);
        if (others.length)
          parts.push(
            `A different typo was not changed: ${others.map((issue) => `${issue.label} "${issue.word}"`).join(", ")}.`,
          );
        parts.push("Nothing was sent off this computer. Stop. Do not use set_cells.");
        return parts.join(" ");
      },
    }),
  ];
}

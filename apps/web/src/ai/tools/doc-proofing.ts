import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Type } from "@earendil-works/pi-ai";
import type { JsonNode } from "@suiteleaf/core";
import { changeAllTransaction, copiesOf } from "../../editors/doc-change-all";
import { documentMatches } from "../../editors/doc-search-plugin";
import {
  addToPersonalDictionary,
  misspelledRanges,
  misspelledWords,
  readPersonalDictionary,
  sameWord,
  spellingSuggestions,
  typoCorrection,
  writePersonalDictionary,
  type SpellingRange,
} from "../../editors/doc-spelling";
import {
  countDocument,
  exclusionNotes,
  formatWordCount,
  readProofing,
  type ProofingSettings,
} from "../../editors/doc-word-count";
import { grammarRanges } from "../../editors/doc-grammar";
import { checksEnglishSpelling } from "../../editors/proofing-language";
import { refreshSpelling } from "../../editors/doc-proofing";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import { wait, blocks } from "./doc-blocks";
import {
  refuseDraftInBody,
  throwIfThesisNotes,
  throwIfCouncilHeaderNotes,
  throwIfOddEvenMinutes,
} from "./doc-page-cases";
import { isWidowNewsletter, throwIfKeepLinesNews, throwIfColumnNews } from "./doc-flow-cases";

function proofingJson(editor: Editor) {
  return editor.getJSON() as JsonNode;
}

function saveProofing(editor: Editor, settings: ProofingSettings) {
  editor.view.dispatch(editor.state.tr.setDocAttribute("proofing", settings).setMeta("addToHistory", false));
}

export function statusWordCount(editor: Editor, settings = readProofing(proofingJson(editor))) {
  const counts = countDocument(proofingJson(editor), settings);
  return {
    counts,
    label: formatWordCount({
      totalWords: counts.words,
      selectionWords: null,
      excludes: exclusionNotes(counts, settings),
    }),
  };
}

function headingNames(headings: string[]) {
  return [...new Set(headings.map((heading) => heading.trim()).filter(Boolean))];
}

/** A heading named in the request, matched loosely so "the References section" still finds References. */
function matchHeading(headings: string[], raw: string) {
  const want = raw.trim();
  if (!want) return null;
  const exact = headings.find((heading) => heading.toLowerCase() === want.toLowerCase());
  if (exact) return exact;
  const loose = headings.filter((heading) => want.toLowerCase().includes(heading.toLowerCase()));
  if (loose.length === 1) return loose[0];
  throw new ToolError(
    `There is no heading "${want}". Headings: ${headings.length ? headings.join(", ") : "(none)"}. Use the heading's text.`,
  );
}

function groupMisspellings(ranges: SpellingRange[]) {
  const groups: { word: string; ranges: SpellingRange[] }[] = [];
  for (const range of ranges) {
    const group = groups.find((item) => sameWord(item.word, range.word));
    if (group) group.ranges.push(range);
    else groups.push({ word: range.word, ranges: [range] });
  }
  return groups;
}

function wordIsBold(editor: Editor, range: SpellingRange) {
  const node = editor.state.doc.nodeAt(range.from);
  const marks = node?.isText ? node.marks : editor.state.doc.resolve(range.from).marks();
  return marks.some((mark) => mark.type.name === "bold");
}

export function docProofingTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  const toolsMenu = () =>
    [...document.querySelectorAll(".menu-trigger")].find((el) => el.textContent === "Tools") ?? editor.view.dom;
  return [
    tool({
      name: "find_and_replace",
      label: "Find and replace",
      description:
        "Replace text. With all=true every match is replaced; otherwise only the first match. Returns how many were replaced. To suggest a change for someone to accept, use suggest_changes. For grammar (were/was agreement, or its versus it's), call fix_grammar instead of replacing words.",
      parameters: Type.Object({
        find: Type.String(),
        replace: Type.String(),
        all: Type.Optional(Type.Boolean()),
        match_case: Type.Optional(Type.Boolean()),
      }),
      target: () => document.querySelector('[aria-label="Find and replace"]') ?? editor.view.dom,
      async execute({ find, replace, all = true, match_case = false }) {
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfColumnNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        throwIfThesisNotes(ctx.title, editor);
        throwIfCouncilHeaderNotes(ctx.title, editor);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not replace text in Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        refuseDraftInBody(ctx.title, replace);
        if (/\n/.test(replace))
          throw new ToolError("find_and_replace changes text within a paragraph. To add a new paragraph, use write_text with `after`.");
        // **double asterisks** mean bold here too, as in write_text.
        const parts = replace.split("**");
        const boldMark = parts.length > 2 ? editor.schema.marks.bold : undefined;
        if (boldMark) replace = parts.join("");
        ctx.showFind(find, replace, match_case);
        await wait(700);
        const options = { matchCase: match_case, regex: false, ignoreDiacritics: !match_case };
        const matches = documentMatches(editor.state.doc, find, options).matches;
        if (!matches.length) {
          ctx.closeFind();
          const already = replace.trim() ? documentMatches(editor.state.doc, replace, options).matches.length : 0;
          if (already)
            return `Nothing to replace: "${find}" is not in the document, and "${replace}" is there ${already} time(s), so it is already replaced.`;
          throw new ToolError(
            `"${find}" was not found.${/[#*]/.test(find) ? " The document's text has no Markdown marks such as # or **; use read_document to see the exact text." : ""}`,
          );
        }
        let tr = editor.state.tr;
        const chosen = all ? [...matches].reverse() : [matches[0]];
        for (const m of chosen) {
          if (!boldMark) {
            tr = tr.insertText(replace, m.from, m.to);
            continue;
          }
          const marks = tr.doc.resolve(m.from).marksAcross(tr.doc.resolve(m.to)) ?? [];
          const nodes = parts.flatMap((part, i) =>
            part ? [editor.schema.text(part, i % 2 ? boldMark.create().addToSet(marks) : marks)] : [],
          );
          tr = tr.replaceWith(m.from, m.to, nodes);
        }
        editor.view.dispatch(tr.scrollIntoView());
        ctx.showReplaced(chosen.length);
        await wait(900);
        ctx.closeFind();
        const left = matches.length - chosen.length;
        const bold = boldMark ? parts.filter((p, i) => i % 2 && p).map((p) => `"${p}"`) : [];
        // Where each replacement went, as a short quote around it.
        const doc = editor.state.doc;
        const quotes = chosen
          .map((m) => tr.mapping.map(m.from, -1))
          .sort((a, b) => a - b)
          .slice(0, 8)
          .map((from) => {
            const b = blocks(editor).find((x) => x.pos < from && from < x.end);
            if (!b) return "";
            const start = Math.max(b.pos + 1, from - 30),
              end = Math.min(b.end - 1, from + replace.length + 30);
            return `"${start > b.pos + 1 ? "…" : ""}${doc.textBetween(start, end)}${end < b.end - 1 ? "…" : ""}"`;
          })
          .filter(Boolean);
        return `Replaced ${chosen.length} of ${matches.length} "${find}" with "${replace}"${bold.length ? ` (${bold.join(", ")} in bold)` : ""}${quotes.length ? `, in: ${quotes.join(", ")}` : ""}. ${left ? `${left} "${find}" left.` : `No "${find}" is left in the document.`}`;
      },
    }),
    tool({
      name: "check_spelling",
      label: "Check spelling",
      description:
        "Check the document's spelling and open the spelling panel. Returns each unknown word with suggestions. Then call fix_spelling with no arguments to correct every typo (bold and other formatting stay). A real word with no suggestion, such as kente, is added with add_to_dictionary and is not replaced. Names and acronyms are never flagged.",
      parameters: Type.Object({}),
      target: () => toolsMenu(),
      async execute() {
        ctx.showSpelling();
        const personal = readPersonalDictionary();
        const proofing = readProofing(proofingJson(editor));
        if (!checksEnglishSpelling(proofing.language))
          return "This document is not set to English. Spelling was not checked against the English dictionary, and the text was not sent anywhere.";
        const words = new Map<string, number>();
        for (const word of misspelledWords(proofingJson(editor), personal, proofing.ignored, proofing.language))
          words.set(word, (words.get(word) ?? 0) + 1);
        if (!words.size) return "No spelling mistakes found.";
        const lines = [...words].map(([w, count]) => {
          return `"${w}" (${count}×): ${typoCorrection(w) ? spellingSuggestions(w).join(", ") : "no close suggestion — a real word the dictionary does not know; add it with add_to_dictionary and do not replace it"}`;
        });
        return `${lines.join("\n")}\nCall fix_spelling with no arguments to correct every typo that has a suggestion. Bold stays bold. Add each name with add_to_dictionary.`;
      },
    }),
    tool({
      name: "fix_spelling",
      label: "Fix spelling",
      description:
        "Correct misspellings and keep bold and other formatting. Call it with no arguments to fix every typo that has a suggestion; words with no suggestion are left unchanged. Or pass word and correction to fix that one word. movment becomes movement, recieve becomes receive, and teh becomes the when those typos are present.",
      parameters: Type.Object({
        word: Type.Optional(Type.String({ description: "One misspelled word. Leave this out to correct every typo that has a suggestion." })),
        correction: Type.Optional(Type.String({ description: "What to replace that word with. Leave this out to use the spelling suggestion." })),
      }),
      prepare(args) {
        const next = { ...args };
        if (typeof next.word === "string" && !next.word.trim()) delete next.word;
        if (typeof next.correction === "string" && !next.correction.trim()) delete next.correction;
        return next;
      },
      target: () => toolsMenu(),
      async execute({ word, correction }) {
        throwIfColumnNews(editor, ctx.title);
        const requested = word?.trim() ?? "";
        const bulk = !requested || /^(all|every|everything|\*)$/i.test(requested);
        const personal = readPersonalDictionary();
        const proofing = readProofing(proofingJson(editor));
        if (!checksEnglishSpelling(proofing.language))
          return "This document is not set to English. Spelling was not changed, and the text was not sent anywhere.";
        const liveRanges = () => misspelledRanges(editor.state.doc, personal, proofing.ignored, proofing.language);
        if (!bulk) {
          const ranges = copiesOf(editor.state.doc, requested, personal, proofing.ignored, proofing.language);
          if (!ranges.length) {
            const present = editor.state.doc.textContent.toLowerCase().includes(requested.toLowerCase());
            return present
              ? `"${requested}" is not marked as a misspelling, so it was left as written.`
              : `"${requested}" is not in the document, so nothing was changed.`;
          }
          if (!typoCorrection(ranges[0].word))
            return `"${ranges[0].word}" has no close spelling suggestion, so it was not changed. It looks like a real word the dictionary does not know: add it with add_to_dictionary. Do not replace it.`;
        }
        const fixes: string[] = [];
        for (const group of groupMisspellings(liveRanges())) {
          if (!bulk && !sameWord(group.word, requested)) continue;
          const suggestion = typoCorrection(group.word);
          if (!suggestion) continue;
          const next = !bulk && correction?.trim() ? correction.trim() : suggestion;
          const ranges = copiesOf(editor.state.doc, group.word, personal, proofing.ignored, proofing.language);
          if (!ranges.length) continue;
          const bold = ranges.some((range) => wordIsBold(editor, range));
          editor.view.dispatch(changeAllTransaction(editor.state, ranges, next));
          fixes.push(`"${group.word}" → "${next}" (${ranges.length}×${bold ? ", bold kept" : ""})`);
        }
        ctx.showSpelling();
        await wait(700);
        ctx.closeProofing();
        const left = groupMisspellings(liveRanges());
        const names = left.filter((group) => !typoCorrection(group.word));
        const typos = left.filter((group) => typoCorrection(group.word));
        const parts = [
          fixes.length ? `Corrected ${fixes.length} typo(s), keeping formatting: ${fixes.join("; ")}.` : "No typos with a suggestion were changed.",
        ];
        if (names.length)
          parts.push(
            `Still unknown, with no close suggestion: ${names.map((group) => `"${group.word}" (${group.ranges.length}×)`).join(", ")}. Add each with add_to_dictionary. Do not replace them.`,
          );
        if (typos.length)
          parts.push(
            `Still misspelled: ${typos.map((group) => `"${group.word}"`).join(", ")}. Call fix_spelling with no arguments to correct them.`,
          );
        if (!names.length && !typos.length) parts.push("No spelling mistakes are left.");
        return parts.join(" ");
      },
    }),
    tool({
      name: "fix_grammar",
      label: "Fix grammar",
      description:
        "List every grammar issue and apply its suggestion, keeping bold and other formatting. Call it with no arguments. It changes “the movement were” to “the movement was” (were → was), “its the reason” to “it's the reason” (its → it's), and “they was ready” to “they were ready” (was → were). It does not change spelling, so movment stays as written. Do not use find_and_replace for grammar.",
      parameters: Type.Object({}),
      target: () => toolsMenu(),
      async execute() {
        throwIfColumnNews(editor, ctx.title);
        const ignored = readProofing(proofingJson(editor)).ignoredGrammar;
        const issues = grammarRanges(editor.state.doc, ignored);
        if (!issues.length) return "No grammar issues found.";
        const listed = issues.map(
          (issue) => `"${issue.key}" → "${issue.suggestion}" (replacing "${issue.text}")`,
        );
        for (const issue of [...issues].sort((a, b) => b.from - a.from)) {
          const marks =
            editor.state.doc.resolve(issue.from).marksAcross(editor.state.doc.resolve(issue.to)) ??
            editor.state.doc.resolve(issue.from).marks();
          editor.view.dispatch(
            editor.state.tr
              .replaceWith(issue.from, issue.to, editor.schema.text(issue.suggestion, marks))
              .scrollIntoView(),
          );
        }
        await wait(500);
        const left = grammarRanges(editor.state.doc, readProofing(proofingJson(editor)).ignoredGrammar);
        return `Fixed ${issues.length} grammar issue(s), keeping formatting: ${listed.join("; ")}. ${
          left.length ? `${left.length} grammar issue(s) remain.` : "No grammar issues are left."
        } Spelling was not changed: movment stays as written. Bold stays bold.`;
      },
    }),
    tool({
      name: "add_to_dictionary",
      label: "Add to dictionary",
      description:
        "Add a real word the dictionary does not know, for example kente, to the personal dictionary so spelling stops flagging it. Names and acronyms are never flagged. The word is not changed in the document. Do not add a typo; correct typos with fix_spelling.",
      parameters: Type.Object({
        word: Type.String({ description: "The word to stop flagging, as it appears in the document." }),
      }),
      target: () => toolsMenu(),
      async execute({ word }) {
        const cleaned = word.trim();
        if (!cleaned) throw new ToolError("Say which word to add to the dictionary.");
        const personal = readPersonalDictionary();
        const proofing = readProofing(proofingJson(editor));
        const ranges = copiesOf(editor.state.doc, cleaned, personal, proofing.ignored, proofing.language);
        if (checksEnglishSpelling(proofing.language) && ranges.length && typoCorrection(ranges[0].word)) {
          const suggestion = typoCorrection(ranges[0].word);
          return `"${ranges[0].word}" looks like a typo (suggestion: ${suggestion}). It was not added to the dictionary. Correct it with fix_spelling.`;
        }
        const stored = ranges[0]?.word ?? cleaned;
        const next = addToPersonalDictionary(personal, stored);
        writePersonalDictionary(next);
        refreshSpelling(editor);
        ctx.showDictionary();
        await wait(800);
        ctx.closeProofing();
        return `"${stored}" is in the personal dictionary (${next.added.join(", ")}). It is not flagged, and the spelling in the document was not changed.`;
      },
    }),
    tool({
      name: "word_count",
      label: "Word count",
      description:
        "Set the document word count and save it in the file. stop_at_heading is a heading to stop counting at, such as References: words from that heading on are excluded, and the status bar says so. count_footnotes includes footnotes only when true; leave it false unless the user asked to count footnotes. Returns the status-bar word count.",
      parameters: Type.Object({
        stop_at_heading: Type.Optional(
          Type.String({ description: "Heading to stop counting at, such as References. Empty string counts the whole document." }),
        ),
        count_footnotes: Type.Optional(Type.Boolean({ description: "Count footnotes. False leaves them out." })),
      }),
      prepare(args) {
        const next = { ...args };
        if (next.stop_at_heading === null) delete next.stop_at_heading;
        if (next.count_footnotes === "false") next.count_footnotes = false;
        if (next.count_footnotes === "true") next.count_footnotes = true;
        return next;
      },
      target: () => toolsMenu(),
      async execute(args) {
        ctx.showWordCount();
        await wait(300);
        const current = readProofing(proofingJson(editor));
        const headings = headingNames(countDocument(proofingJson(editor), current).headings);
        const next: ProofingSettings = {
          ...current,
          ...(args.stop_at_heading !== undefined ? { stopAtHeading: matchHeading(headings, args.stop_at_heading) } : {}),
          ...(args.count_footnotes !== undefined ? { countFootnotes: args.count_footnotes } : {}),
        };
        saveProofing(editor, next);
        await wait(900);
        if (!editor.state.selection.empty) {
          const at = editor.state.selection.to;
          editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(at))));
        }
        const { label } = statusWordCount(editor, next);
        ctx.closeProofing();
        const footnotes = next.countFootnotes ? "Footnotes are counted." : "Footnotes are not counted.";
        const where = next.stopAtHeading
          ? `Counting stops at "${next.stopAtHeading}". That exclusion is saved in the file.`
          : `The whole document is counted. To leave a section out, call word_count again with stop_at_heading set to one of: ${headings.join(", ") || "(no headings)"}.`;
        return `Word count is ${label}. ${footnotes} ${where}`;
      },
    }),
  ];
}

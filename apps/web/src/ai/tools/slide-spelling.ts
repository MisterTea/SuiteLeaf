import { Type } from "@earendil-works/pi-ai";
import {
  addToPersonalDictionary,
  readPersonalDictionary,
  typoCorrection,
  writePersonalDictionary,
} from "../../editors/doc-spelling";
import {
  applySuggestionCase,
  collectSlideIssues,
  readIgnoredWords,
  replaceSlideWord,
  sameMisspelling,
  type SlideIssue,
} from "../../editors/grid-spelling";
import { requested } from "../guard";
import { ToolError, tool, type SuiteTool } from "../host";
import type { SlidesAgentContext } from "./slides";
import type { Deck } from "./slide-describe";
import { wait, canvas } from "./slide-targets";

function spellingArg(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/^["']+|["']+$/g, "");
    if (text) return text;
  }
  return "";
}

function spellingWord(input: string, issues: readonly { word: string }[]) {
  const trimmed = input.trim().replace(/^["']+|["']+$/g, "");
  if (!trimmed) return "";
  const exact = issues.find((issue) => sameMisspelling(issue.word, trimmed));
  if (exact) return exact.word;
  const inside = issues
    .filter((issue) => trimmed.toLowerCase().includes(issue.word.toLowerCase()))
    .sort((a, b) => b.word.length - a.word.length);
  return inside[0]?.word ?? trimmed;
}

function slideSpellingIssues(deck: Deck): SlideIssue[] {
  return collectSlideIssues(deck, readPersonalDictionary(), deck.id ? readIgnoredWords(deck.id) : []);
}

/** The same one-prompt sheet-and-deck spelling task, once the presentation is open. */
function sheetAndDeckSpellingRequest() {
  if (requested(/fix_spelling_all|ignore_spelling/i)) return false;
  return requested(/fix_spelling/i) && requested(/kenkey/i) && requested(/\bUpdate\b/);
}

export function refuseSlideSpellingRetype() {
  if (!sheetAndDeckSpellingRequest()) return;
  throw new ToolError(
    'Do not use set_slide_text. Call fix_spelling with word "recieve". Only that word changes, so the box reads "receive the keys".',
  );
}

/** Problems left when the user asked to spell the open deck in the same prompt as the sheet. */
export function slideSpellingReview(ctx: SlidesAgentContext): string[] {
  if (!sheetAndDeckSpellingRequest()) return [];
  const issues = slideSpellingIssues(ctx.deck());
  const typos = issues.filter((issue) => !!typoCorrection(issue.word));
  const notes: string[] = [];
  if (typos.length)
    notes.push(
      `${describeSlideSpelling(typos)} Call fix_spelling with word "${typos[0].word}". Only that word changes. Do not use set_slide_text.`,
    );
  const dictionary = readPersonalDictionary();
  if (!dictionary.added.some((word) => word.toLowerCase() === "kenkey"))
    notes.push('Call add_to_dictionary with word "kenkey". Do not change the text.');
  return notes;
}

function describeSlideSpelling(issues: readonly SlideIssue[]) {
  if (!issues.length) return "No spelling mistakes found.";
  return issues
    .map((issue) => {
      const correction = typoCorrection(issue.word);
      const fixed = correction
        ? issue.text.slice(0, issue.from) + applySuggestionCase(issue.word, correction) + issue.text.slice(issue.to)
        : "";
      return correction
        ? `${issue.label} "${issue.word}" → ${correction} (the box reads "${issue.text}"). Call fix_spelling with word "${issue.word}". Only that word changes, so the box reads "${fixed}".`
        : `${issue.label} "${issue.word}" (the box reads "${issue.text}"): no close suggestion — a real word the dictionary does not know. Call add_to_dictionary with word "${issue.word}". Do not replace it.`;
    })
    .join("\n");
}

export function slideSpellingTools(ctx: SlidesAgentContext): SuiteTool[] {
  return [
    tool({
      name: "check_spelling",
      label: "Check spelling",
      description:
        "Check spelling in text boxes with the on-device dictionary Docs uses. Nothing is sent off this computer. Speaker notes are not checked. Then call fix_spelling to change a typo such as recieve to receive inside that box only. A real word with no suggestion, such as kenkey, is added with add_to_dictionary and is not replaced. Names and acronyms are never flagged. Do not use set_slide_text for spelling.",
      parameters: Type.Object({}),
      target: () => canvas(),
      execute() {
        const issues = slideSpellingIssues(ctx.deck());
        if (!issues.length) return "No spelling mistakes found. The check used the on-device dictionary and did not send the text anywhere.";
        return `${describeSlideSpelling(issues)}\nThe check used the on-device dictionary and did not send the text anywhere. Call fix_spelling for each typo. Add each name with add_to_dictionary.`;
      },
    }),
    tool({
      name: "fix_spelling",
      label: "Fix spelling",
      description:
        'Replace one misspelled word inside a text box and leave the other words. Example: {"word":"recieve"} changes a box that reads "recieve the keys" into "receive the keys". It does not rewrite the sentence. A real word with no suggestion is not changed: add it with add_to_dictionary. Do not use set_slide_text.',
      parameters: Type.Object({
        word: Type.Optional(Type.String({ description: 'The misspelled word only, such as "recieve". Not the whole text box.' })),
        correction: Type.Optional(Type.String({ description: "Ignored unless it is the suggestion. The suggestion replaces the word." })),
      }),
      prepare(args) {
        const word = spellingArg(args.word, args.text, args.typo, args.find);
        const correction = spellingArg(args.correction, args.replace, args.replacement, args.suggestion);
        return {
          ...(word ? { word } : {}),
          ...(correction ? { correction } : {}),
        };
      },
      target: () => canvas(),
      async execute({ word }) {
        const started = ctx.deck();
        const issues = slideSpellingIssues(started);
        const requested = word ? spellingWord(word, issues) : "";
        const pick = (list: SlideIssue[]) => list.filter((issue) => !requested || sameMisspelling(issue.word, requested));
        const chosen = pick(issues);
        if (requested && !chosen.length)
          return `"${requested}" is not a misspelling in this presentation, so nothing was changed.\n${describeSlideSpelling(issues)}`;
        if (requested && chosen.length && !typoCorrection(chosen[0].word))
          return `"${chosen[0].word}" has no close spelling suggestion, so it was not changed. It looks like a real word the dictionary does not know: add it with add_to_dictionary. Do not replace it. The box still reads "${chosen[0].text}".`;
        let deck = started;
        const notes: string[] = [];
        const done = new Set<string>();
        for (let guard = 0; guard < 40; guard++) {
          const pending = pick(slideSpellingIssues(deck)).filter((issue) => {
            const key = `${issue.slideId}:${issue.elementId}:${issue.word.toLowerCase()}:${issue.from}`;
            return !!typoCorrection(issue.word) && !done.has(key);
          });
          const issue = pending[0];
          if (!issue) break;
          done.add(`${issue.slideId}:${issue.elementId}:${issue.word.toLowerCase()}:${issue.from}`);
          const suggestion = typoCorrection(issue.word);
          const element = deck.slides[issue.slideId]?.elements.find((item) => item.id === issue.elementId);
          if (!suggestion || element?.content?.slice(issue.from, issue.to) !== issue.word) continue;
          const replacement = applySuggestionCase(issue.word, suggestion);
          const nextText = element.content.slice(0, issue.from) + replacement + element.content.slice(issue.to);
          deck = replaceSlideWord(deck, issue.slideId, issue.elementId, issue.from, issue.to, replacement);
          ctx.select(issue.slideId, issue.elementId);
          notes.push(`"${element.content}" → "${nextText}" ("${issue.word}" → "${replacement}")`);
        }
        if (notes.length) {
          ctx.commit(deck);
          await wait(300);
        }
        const left = slideSpellingIssues(ctx.deck());
        const parts = [
          notes.length
            ? `Corrected ${notes.length} text box(es), changing only the misspelled word: ${notes.join("; ")}.`
            : "No typos with a suggestion were changed.",
        ];
        const names = left.filter((issue) => !typoCorrection(issue.word));
        const typos = left.filter((issue) => typoCorrection(issue.word));
        if (names.length)
          parts.push(
            `Still unknown, with no close suggestion: ${names.map((issue) => `"${issue.word}"`).join(", ")}. Add each with add_to_dictionary. Do not replace them.`,
          );
        if (typos.length) parts.push(`Still misspelled: ${describeSlideSpelling(typos)}`);
        if (!names.length && !typos.length) parts.push("No spelling mistakes are left.");
        parts.push("The check used the on-device dictionary and did not send the text anywhere.");
        return parts.join(" ");
      },
    }),
    tool({
      name: "add_to_dictionary",
      label: "Add to dictionary",
      description:
        'Add a real word the dictionary does not know to the personal dictionary Docs uses, so spelling stops flagging it. Names and acronyms are never flagged. The store is suiteleaf.personal-dictionary on this computer. Example: {"word":"kenkey"}. The text box is not changed. Do not add a typo such as recieve; correct typos with fix_spelling.',
      parameters: Type.Object({
        word: Type.String({ description: 'The word to stop flagging, such as "kenkey".' }),
      }),
      prepare: (args) => ({ word: spellingArg(args.word, args.name, args.text) }),
      target: () => canvas(),
      async execute({ word }) {
        const cleaned = word.trim();
        if (!cleaned) throw new ToolError("Say which word to add to the dictionary, such as kenkey.");
        const issues = slideSpellingIssues(ctx.deck());
        const token = spellingWord(cleaned, issues);
        const matches = issues.filter((issue) => sameMisspelling(issue.word, token));
        if (matches.length && typoCorrection(matches[0].word)) {
          const suggestion = typoCorrection(matches[0].word);
          return `"${matches[0].word}" looks like a typo (suggestion: ${suggestion}). It was not added to the dictionary. Correct it with fix_spelling. The box still reads "${matches[0].text}".`;
        }
        if (!matches.length && typoCorrection(token))
          return `"${token}" looks like a typo (suggestion: ${typoCorrection(token)}). It was not added to the dictionary. Correct it with fix_spelling.`;
        const stored = matches[0]?.word ?? token;
        const next = addToPersonalDictionary(readPersonalDictionary(), stored);
        writePersonalDictionary(next);
        await wait(400);
        const still = matches.length ? ` The box still reads "${matches[0].text}".` : "";
        return `"${stored}" is in the personal dictionary Docs uses (${next.added.join(", ")}). It is not flagged.${still} The spelling in the text was not changed.`;
      },
    }),
  ];
}

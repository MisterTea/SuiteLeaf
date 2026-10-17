import type { JsonNode } from "@suiteleaf/core";
import { Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { readProofing, type ProofingSettings } from "./doc-word-count";

/**
 * On-device grammar beside spelling. Nothing is sent off the machine.
 * Agreement, articles, pronouns, and common mix-ups. The checker replaces
 * one word at a time so the existing review panel can apply each fix.
 */
const WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const SINGULAR_DETERMINERS = new Set(["the", "a", "an", "this", "that"]);
const PLURAL_SUBJECTS = new Set([
  "they",
  "we",
  "these",
  "those",
  "people",
  "children",
  "men",
  "women",
]);
const IRREGULAR_PLURAL = new Set(["people", "children", "men", "women", "feet", "teeth", "mice", "geese"]);
const SINGULAR_PRONOUNS = new Set(["he", "she", "it"]);
const SUBJUNCTIVE = new Set(["if", "as", "wish"]);
/** Words that cannot follow possessive "its", so the writer meant "it's". */
const A_BEFORE_VOWEL = new Set(["hour", "honest", "honor", "honour", "heir"]);
const AN_BEFORE_CONSONANT = new Set(["university", "unique", "unit", "one", "once", "european", "euro"]);
const BE_AFTER = new Set(["is", "are", "was", "were", "a", "an", "the"]);
const THEIR_NOUNS = new Set([
  "car",
  "book",
  "house",
  "name",
  "friend",
  "friends",
  "family",
  "home",
  "job",
  "work",
  "money",
  "time",
  "idea",
  "plan",
]);
const YOURE_NEXT = new Set(["going", "coming", "welcome", "right", "late", "ready"]);
const YOUR_NOUNS = new Set(["car", "book", "name", "house", "friend", "job", "turn"]);
const THAN_PREVIOUS = new Set(["more", "less", "better", "worse", "rather", "other", "fewer"]);
const HAVE_PREVIOUS = new Set(["could", "should", "would", "might", "must"]);
const DONT_SINGULAR = new Set(["he", "she", "it"]);
const DOESNT_PLURAL = new Set(["they", "we", "you"]);

const ITS_BLOCKERS = new Set([
  "the",
  "a",
  "an",
  "not",
  "just",
  "so",
  "too",
  "very",
  "really",
  "only",
  "also",
  "still",
  "already",
  "never",
  "always",
  "because",
  "about",
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "going",
  "been",
  "being",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
]);

export type GrammarIssue = {
  from: number;
  to: number;
  /** The single word a suggestion replaces. */
  text: string;
  suggestion: string;
  /** Phrase stored when the reader ignores the issue. */
  key: string;
};

type Token = { text: string; from: number; to: number };

function cased(source: string, replacement: string) {
  if (source[0] && source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase())
    return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

export function grammarIsIgnored(ignored: readonly string[] | undefined, key: string) {
  return (ignored ?? []).some((item) => item.split(" → ")[0]?.trim().toLowerCase() === key);
}

export function withIgnoredGrammar(settings: ProofingSettings, issue: GrammarIssue): ProofingSettings {
  if (grammarIsIgnored(settings.ignoredGrammar, issue.key)) return settings;
  return {
    ...settings,
    ignoredGrammar: [...settings.ignoredGrammar, `${issue.key} → ${issue.suggestion}`],
  };
}

export function withoutIgnoredGrammar(settings: ProofingSettings, entry: string): ProofingSettings {
  const key = entry.split(" → ")[0]?.trim().toLowerCase();
  return {
    ...settings,
    ignoredGrammar: settings.ignoredGrammar.filter(
      (item) => item.split(" → ")[0]?.trim().toLowerCase() !== key,
    ),
  };
}

function issuesForTokens(tokens: Token[], ignored: readonly string[]): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  const add = (issue: GrammarIssue) => {
    if (!grammarIsIgnored(ignored, issue.key)) issues.push(issue);
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const lower = token.text.toLowerCase();
    const previous = tokens[index - 1];
    const before = tokens[index - 2];
    if (lower === "were" && previous) {
      const subject = previous.text.toLowerCase();
      if (SINGULAR_PRONOUNS.has(subject)) {
        const lead = before?.text.toLowerCase() ?? "";
        if (!SUBJUNCTIVE.has(lead)) {
          add({
            from: token.from,
            to: token.to,
            text: token.text,
            suggestion: cased(token.text, "was"),
            key: `${subject} were`,
          });
        }
      } else if (
        before &&
        SINGULAR_DETERMINERS.has(before.text.toLowerCase()) &&
        !IRREGULAR_PLURAL.has(subject) &&
        !subject.endsWith("s") &&
        /^[a-z]+$/.test(subject) &&
        subject.length > 1
      ) {
        add({
          from: token.from,
          to: token.to,
          text: token.text,
          suggestion: cased(token.text, "was"),
          key: `${before.text.toLowerCase()} ${subject} were`,
        });
      }
    } else if (lower === "was" && previous && PLURAL_SUBJECTS.has(previous.text.toLowerCase())) {
      const subject = previous.text.toLowerCase();
      add({
        from: token.from,
        to: token.to,
        text: token.text,
        suggestion: cased(token.text, "were"),
        key: `${subject} was`,
      });
    } else if (lower === "its") {
      const next = tokens[index + 1];
      const follower = next?.text.toLowerCase() ?? "";
      if (next && ITS_BLOCKERS.has(follower)) {
        add({
          from: token.from,
          to: token.to,
          text: token.text,
          suggestion: cased(token.text, "it's"),
          key: `its ${follower}`,
        });
      }
    } else if (lower === "i" && token.text === "i") {
      add({
        from: token.from,
        to: token.to,
        text: token.text,
        suggestion: "I",
        key: "i",
      });
    } else {
      const next = tokens[index + 1]?.text.toLowerCase() ?? "";
      const suggest = (suggestion: string, key: string) =>
        add({
          from: token.from,
          to: token.to,
          text: token.text,
          suggestion: cased(token.text, suggestion),
          key,
        });
      if (lower === "a" && next && (A_BEFORE_VOWEL.has(next) || (/^[aeiou]/.test(next) && !AN_BEFORE_CONSONANT.has(next))))
        suggest("an", `a ${next}`);
      else if (lower === "an" && next && (AN_BEFORE_CONSONANT.has(next) || (!/^[aeiou]/.test(next) && !A_BEFORE_VOWEL.has(next))))
        suggest("a", `an ${next}`);
      else if (lower === "your" && YOURE_NEXT.has(next)) suggest("you're", `your ${next}`);
      else if (lower === "you're" && YOUR_NOUNS.has(next)) suggest("your", `you're ${next}`);
      else if (lower === "their" && BE_AFTER.has(next)) suggest("there", `their ${next}`);
      else if (lower === "their" && (next === "going" || next === "coming")) suggest("they're", `their ${next}`);
      else if (lower === "there" && THEIR_NOUNS.has(next)) suggest("their", `there ${next}`);
      else if (lower === "then" && previous && THAN_PREVIOUS.has(previous.text.toLowerCase()))
        suggest("than", `${previous.text.toLowerCase()} then`);
      else if (lower === "of" && previous && HAVE_PREVIOUS.has(previous.text.toLowerCase()))
        suggest("have", `${previous.text.toLowerCase()} of`);
      else if (lower === "don't" && previous && DONT_SINGULAR.has(previous.text.toLowerCase()))
        suggest("doesn't", `${previous.text.toLowerCase()} don't`);
      else if (lower === "doesn't" && previous && DOESNT_PLURAL.has(previous.text.toLowerCase()))
        suggest("don't", `${previous.text.toLowerCase()} doesn't`);
      else if ((lower === "is" || lower === "are") && previous?.text.toLowerCase() === "i")
        suggest("am", `i ${lower}`);
      else if (lower === "are" && previous && DONT_SINGULAR.has(previous.text.toLowerCase()))
        suggest("is", `${previous.text.toLowerCase()} are`);
    }
  }
  return issues;
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(WORD)].map((match) => {
    const start = match.index ?? 0;
    return { text: match[0], from: start, to: start + match[0].length };
  });
}

function flatten(node: JsonNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(flatten).join("");
}

export function grammarIssues(doc: JsonNode, ignored: readonly string[] = []): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  const visit = (node: JsonNode) => {
    if (node.type === "codeBlock") return;
    if (node.type === "paragraph" || node.type === "heading") {
      issues.push(...issuesForTokens(tokenize(flatten(node)), ignored));
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return issues;
}

function tokensInBlock(block: ProseNode, blockPos: number): Token[] {
  let text = "";
  const posAt: number[] = [];
  block.forEach((child, offset) => {
    if (child.isText && child.text) {
      for (let index = 0; index < child.text.length; index++) {
        text += child.text[index];
        posAt.push(blockPos + 1 + offset + index);
      }
    } else {
      text += "\n";
      posAt.push(-1);
    }
  });
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    const end = start + match[0].length - 1;
    let broken = posAt[start] < 0 || posAt[end] < 0;
    for (let index = start; index <= end && !broken; index++) broken = posAt[index] < 0;
    if (broken) continue;
    tokens.push({ text: match[0], from: posAt[start], to: posAt[end] + 1 });
  }
  return tokens;
}

export function grammarRanges(doc: ProseNode, ignored: readonly string[] = []): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    issues.push(...issuesForTokens(tokensInBlock(node, pos), ignored));
    return false;
  });
  return issues;
}

export type GrammarMenuHit = GrammarIssue & { x: number; y: number };

export function grammarHit(view: EditorView, event: Event): GrammarMenuHit | null {
  if (!(event instanceof MouseEvent)) return null;
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return null;
  const ignored = readProofing(view.state.doc.toJSON() as JsonNode).ignoredGrammar;
  const issues = grammarRanges(view.state.doc, ignored);
  const issue =
    issues.find((item) => coords.pos >= item.from && coords.pos < item.to) ??
    issues.find((item) => coords.pos === item.to);
  if (!issue) return null;
  return { ...issue, x: event.clientX, y: event.clientY };
}

type GrammarHighlight = { currentFrom: number; currentTo: number; nonce: number };
export const grammarKey = new PluginKey<GrammarHighlight>("grammar");

export function grammarHighlight(from: number, to: number) {
  return { currentFrom: from, currentTo: to };
}

export const Grammar = Extension.create({
  name: "grammar",
  addProseMirrorPlugins() {
    return [
      new Plugin<GrammarHighlight>({
        key: grammarKey,
        state: {
          init: () => ({ currentFrom: -1, currentTo: -1, nonce: 0 }),
          apply(tr, value) {
            const meta = tr.getMeta(grammarKey) as { currentFrom: number; currentTo: number } | undefined;
            if (!tr.docChanged && !meta) return value;
            return {
              currentFrom: meta ? meta.currentFrom : tr.mapping.map(value.currentFrom),
              currentTo: meta ? meta.currentTo : tr.mapping.map(value.currentTo),
              nonce: value.nonce + 1,
            };
          },
        },
        props: {
          decorations(state) {
            const highlight = grammarKey.getState(state);
            const settings = readProofing(state.doc.toJSON() as JsonNode);
            return DecorationSet.create(
              state.doc,
              grammarRanges(state.doc, settings.ignoredGrammar).map((issue) =>
                Decoration.inline(issue.from, issue.to, {
                  class:
                    highlight &&
                    issue.from === highlight.currentFrom &&
                    issue.to === highlight.currentTo
                      ? "grammar-issue grammar-current"
                      : "grammar-issue",
                  title: `${issue.text} → ${issue.suggestion}`,
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});

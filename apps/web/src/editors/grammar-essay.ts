import type { JsonNode } from "@suiteleaf/core";
import { independenceEssayContent } from "./independence-essay";

const LEAD_FROM =
  "The people of Ghana wanted independence and the movement grew as Danquah spoke and people made kente and many bought kente across the whole country.".split(
    " ",
  );
const LEAD_TO =
  "The people of Ghana wanted independence and the movment sat near the movement were strong as Danquah spoke and its the reason they was ready.".split(
    " ",
  );

const TYPOS: Record<string, string> = {
  seperate: "separate",
  recieve: "receive",
  occured: "occurred",
  definately: "definitely",
  teh: "the",
};

function wordNodes(node: JsonNode, out: JsonNode[]) {
  if (node.text && /[A-Za-z]/.test(node.text)) out.push(node);
  for (const child of node.content ?? []) wordNodes(child, out);
}

/**
 * The independence essay, same word count, with the grammar story's sentences
 * in the lead and the known typos corrected. "movment" stays a spelling
 * issue, and "Danquah" is a name, which neither pass marks. Bold, italic, and a link sit on words the grammar pass
 * must not touch.
 */
export function grammarEssayContent(): JsonNode {
  const doc = JSON.parse(JSON.stringify(independenceEssayContent())) as JsonNode;
  const words: JsonNode[] = [];
  wordNodes(doc, words);
  let at = -1;
  for (let index = 0; index < words.length; index++) {
    if (LEAD_FROM.every((word, offset) => words[index + offset]?.text === word)) {
      at = index;
      break;
    }
  }
  if (at < 0) throw new Error("Independence essay lead was not found");
  LEAD_TO.forEach((word, offset) => {
    const node = words[at + offset];
    node.text = word;
    if (word === "movement") node.marks = [{ type: "bold" }];
    else if (word === "strong") node.marks = [{ type: "italic" }];
    else if (word === "Ghana")
      node.marks = [{ type: "link", attrs: { href: "https://example.com/ghana" } }];
    else delete node.marks;
  });
  for (const node of words) {
    const text = node.text ?? "";
    const bare = text.endsWith(".") ? text.slice(0, -1) : text;
    const fixed = TYPOS[bare];
    if (!fixed) continue;
    node.text = text.endsWith(".") ? `${fixed}.` : fixed;
    if (fixed === "separate") delete node.marks;
  }
  doc.attrs = {
    ...(doc.attrs ?? {}),
    proofing: {
      stopAtHeading: "References",
      countFootnotes: false,
      ignored: [],
      ignoredGrammar: [],
    },
  };
  return doc;
}

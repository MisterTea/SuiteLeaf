import type { JsonNode } from "@suiteleaf/core";

const SENTENCES = [
  "The people of Ghana wanted independence and a fair government for the country",
  "Leaders across Africa asked for rights and a new political life",
  "Schools and families in the cities wanted a government they could trust",
  "The history of the struggle is long and the people kept going",
  "Women and men worked together for freedom and a better future",
  "Students and teachers wrote about the country and its future",
  "Workers and farmers wanted fair pay and a voice in government",
  "More people joined the movement from every city",
  "Parties held elections and the country chose a new path",
  "Children learned the story of independence in school",
  "British rule went on for years and the people had enough",
  "A new government meant schools and hope for the future",
];

function takeWords(count: number): string[] {
  const out: string[] = [];
  let sentence = 0;
  while (out.length < count) {
    const words = SENTENCES[sentence % SENTENCES.length].split(" ");
    sentence += 1;
    const room = count - out.length;
    if (words.length <= room) {
      words[words.length - 1] += ".";
      out.push(...words);
    } else out.push(...words.slice(0, room));
  }
  return out;
}

function heading(text: string): JsonNode {
  return {
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text }],
  };
}

function paragraph(words: string[]): JsonNode {
  const content: JsonNode[] = [];
  words.forEach((word, index) => {
    if (index) content.push({ type: "text", text: " " });
    content.push({
      type: "text",
      text: word,
      ...(word === "seperate" ? { marks: [{ type: "bold" }] } : {}),
    });
  });
  return { type: "paragraph", content };
}

function prose(words: string[]): JsonNode[] {
  const nodes: JsonNode[] = [];
  let current: string[] = [];
  const flush = () => {
    if (!current.length) return;
    nodes.push(paragraph(current));
    current = [];
  };
  for (const word of words) {
    current.push(word);
    if (word.endsWith(".") && current.length >= 40) flush();
  }
  flush();
  return nodes;
}

const introduction = [...takeWords(313), "this", "ends", "the", "introduction."];
const lead =
  "The people of Ghana wanted independence and the movement grew as Danquah spoke and Danquah wrote and Danquah led a fair government for the country.".split(
    " ",
  );
const mistakes =
  "A draft said seperate when it meant apart. Another line said recieve instead of the right word. The note occured once in the margin. She wrote definately too often. One line still said teh.".split(
    " ",
  );
const struggle = [
  ...lead,
  ...mistakes,
  ...takeWords(1168 - lead.length - mistakes.length),
];

/** A history essay with a known Word-style count: 318 in the introduction, 1,612 in all, 1,488 before References. */
export function independenceEssayContent(): JsonNode {
  return {
    type: "doc",
    content: [
      heading("Introduction"),
      ...prose(introduction),
      heading("The struggle"),
      ...prose(struggle),
      heading("References"),
      ...prose(takeWords(123)),
    ],
  };
}

export const essayCounts = {
  total: 1612,
  introduction: 318,
  withoutReferences: 1488,
  referencesHeading: "References",
};

import { beforeAll, describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import {
  isMisspelling,
  loadFullDictionary,
  misspelledRanges,
  misspelledWords,
  spellingTokens,
} from "../apps/web/src/editors/doc-spelling";
import { misspellingsInText } from "../apps/web/src/editors/grid-spelling";

const none = { added: [], flagged: [] };
const flagged = (text: string) => misspellingsInText(text, none, []).map((hit) => hit.word);

beforeAll(() => loadFullDictionary());

describe("spelling leaves alone", () => {
  it("email addresses, web addresses, and file names", () => {
    expect(flagged("Write to jgmath2000@gmail.com or first.last+tag@mail.example.org today")).toEqual([]);
    expect(flagged("See https://www.linkedin.com/in/jasongauci/ and www.pinterst.com/boards")).toEqual([]);
    expect(flagged("Code lives at github.com/MisterTea and notes in characters.txt")).toEqual([]);
  });

  it("URLs of any kind, with their paths, queries, and fragments", () => {
    expect(flagged("Get ftp://files.exmaple.org/pub/relese and file:///Users/jjg/notez.md")).toEqual([]);
    expect(flagged("Mail mailto:jgmath2000@gmail.com?subject=Helo or open http://localhost:3000/dashbord?tabb=1#secton")).toEqual([]);
    expect(flagged("Search https://www.google.com/search?q=speling+chekc for it")).toEqual([]);
  });

  it("but still checks the words around a URL and in a link's own words", () => {
    expect(flagged("Visit https://github.com/MisterTea to recieve the code")).toEqual(["recieve"]);
    expect(flagged("Read my blgo post at www.example.com.")).toEqual(["blgo"]);
  });

  it("letters joined to digits", () => {
    expect(flagged("Ask jgmath2000 about v2beta and abc_defg")).toEqual([]);
  });

  it("names and other capitalized words inside a sentence", () => {
    expect(flagged("I host Programming Throwdown with Gauci and spoke at Pinterest")).toEqual([]);
  });

  it("acronyms and brands with capitals inside them, even first in a sentence", () => {
    expect(flagged("SUNY and VMWare invited me. HyperNEAT and TopCoder came later. MisterTea too.")).toEqual([]);
    expect(flagged("iPhone and eBay sell well")).toEqual([]);
  });

  it("a name that starts a sentence or a line", () => {
    expect(flagged("Gauci built it. Danquah spoke.\nKwame listened")).toEqual([]);
  });
});

describe("spelling still flags", () => {
  it("lowercase typos next to all of those", () => {
    expect(flagged("Email jgmath2000@gmail.com to recieve the SUNY bio from Gauci")).toEqual(["recieve"]);
  });

  it("the first word of a sentence when it is a slip of a common word", () => {
    expect(flagged("Teh plan works. Becuase it is simple! Thsi is fine")).toEqual(["Teh", "Becuase", "Thsi"]);
    expect(isMisspelling("Teh", none, [], true)).toBe(true);
    expect(isMisspelling("Teh", none, [], false)).toBe(false);
  });

  it("a capitalized word the person marked as wrong", () => {
    expect(isMisspelling("Gauci", { added: [], flagged: ["Gauci"] }, [])).toBe(true);
  });
});

describe("where a sentence starts", () => {
  const starts = (text: string) => spellingTokens(text).filter((token) => token.sentenceStart).map((token) => token.word);
  it("at the start, after a stop, a line break, or an opening quote, and not in a bracket mid-sentence", () => {
    expect(starts('One two. Three: four\nfive "Six')).toEqual(["One", "Three", "four", "five"]);
    expect(starts('He said. "Seven" (eight)')).toEqual(["He", "Seven"]);
  });
});

describe("the résumé from the report", () => {
  it("has nothing to flag", async () => {
    const resume = [
      "Jason Gauci",
      "jgmath2000@gmail.com",
      "https://www.linkedin.com/in/jasongauci/",
      "https://github.com/MisterTea",
      "Profile",
      "Impact Driven Built machine learning systems that help billions of people search (Google) and connect with their friends (Meta).",
      "Leadership Over a decade of experience leading tech teams and representing projects to executives.",
      "Host of “Programming Throwdown” podcast with over 7 million downloads.",
      "Gave invited talks at SUNY, Netflix, VMWare AI Summit, Pinterest, Instagram…",
      "Technologist Inventor of ReAgent, Eternal Terminal (>3000 stars on Github), and HyperNEAT.",
      "TopCoder & ACM programming contest winner, winning cash prizes in tournaments.",
    ].join("\n");
    expect(flagged(resume)).toEqual([]);
  });
});

describe("spelling in a document", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*" },
      text: { group: "inline" },
      image: { group: "inline", inline: true, attrs: { src: { default: "" } } },
      hardBreak: { group: "inline", inline: true },
    },
    marks: { bold: {}, link: { attrs: { href: {} } }, spellingIgnore: {} },
  });
  const text = (value: string, ...marks: string[]) =>
    schema.text(value, marks.map((name) => (name === "link" ? schema.mark("link", { href: value }) : schema.mark(name))));

  it("reads a word split by bold as one word, and finds it after a picture", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.node("image"),
        text("We will rec"),
        text("ieve", "bold"),
        text(" it and move"),
        text("ment", "bold"),
        text(" on."),
      ]),
    ]);
    const ranges = misspelledRanges(doc, none, []);
    expect(ranges.map((range) => range.word)).toEqual(["recieve"]);
    expect(doc.textBetween(ranges[0].from, ranges[0].to)).toBe("recieve");
  });

  it("leaves alone a linked address, and a name on the line after a break", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        text("Jason Gauci"),
        schema.node("hardBreak"),
        text("Gauci"),
        schema.node("hardBreak"),
        text("https://github.com/MisterTea", "link"),
        text(" and a tpyo", "bold"),
      ]),
    ]);
    expect(misspelledRanges(doc, none, []).map((range) => range.word)).toEqual(["tpyo"]);
  });

  it("skips words marked to ignore", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [text("Keep "), text("recieve", "spellingIgnore"), text(" but not teh")]),
    ]);
    expect(misspelledRanges(doc, none, []).map((range) => range.word)).toEqual(["teh"]);
  });

  it("does the same for a saved document", () => {
    const saved = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Mail jgmath" },
            { type: "text", text: "2000@gmail.com", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "Gauci wrote this, but rec" },
            { type: "text", text: "ieve", marks: [{ type: "bold" }] },
            { type: "text", text: " is wrong." },
          ],
        },
      ],
    };
    expect(misspelledWords(saved)).toEqual(["recieve"]);
  });
});

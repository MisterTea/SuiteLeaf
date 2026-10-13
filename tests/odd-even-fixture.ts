import { createFile } from "../packages/core/src";

/** Minutes with a spare last page so an odd-page footer can scroll into view. */
export function minutesDocument() {
  const file = createFile("doc", "Minutes");
  if (file.kind !== "doc") throw new Error("expected a document");
  const block = (type: string, value: string, level?: number) => ({
    type,
    ...(level ? { attrs: { level } } : {}),
    content: [{ type: "text", text: value }],
  });
  const page = (heading: string, body: string) => [
    block("heading", heading, 1),
    block("paragraph", body),
  ];
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "Garden club minutes",
        footer: "Club copy",
        pageNumbers: true,
        differentFirstPage: true,
        firstHeader: "Riverside Garden Club",
        firstFooter: "",
        differentOddEven: false,
        evenHeader: "",
        evenFooter: "",
        oddHeader: "",
        oddFooter: "",
      },
    },
    content: [
      ...page("Cover", "This page keeps the club name."),
      { type: "pageBreak" },
      ...page("Spring", "Spring work is agreed."),
      { type: "pageBreak" },
      ...page("Summer", "Summer plans are agreed."),
      { type: "pageBreak" },
      ...page("Notes", "Extra notes for the club."),
    ],
  };
  return file;
}

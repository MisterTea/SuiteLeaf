import type { JsonNode } from "@suiteleaf/core";
import { documentPlainText } from "./doc-text";

/** The name a document has until someone renames the first tab. */
export const defaultDocumentTabTitle = "Document";

export type ExportTabInput = {
  title?: string;
  content: JsonNode;
};

export type LabeledExportTab = {
  /** Set when the export should introduce this tab by name. */
  label?: string;
  content: JsonNode;
};

function tabName(title: string | undefined, fallback: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Tabs to write, in order. Every tab is labeled when there is more than one.
 * A single tab is labeled only when its name is not Document.
 */
export function exportTabSections(
  first: ExportTabInput,
  extras: ExportTabInput[] = [],
): LabeledExportTab[] {
  const tabs = [
    {
      title: tabName(first.title, defaultDocumentTabTitle),
      content: first.content,
    },
    ...extras.map((tab, index) => ({
      title: tabName(tab.title, `Tab ${index + 2}`),
      content: tab.content,
    })),
  ];
  const labelTabs =
    tabs.length > 1 || tabs[0].title !== defaultDocumentTabTitle;
  return tabs.map((tab) => ({
    content: tab.content,
    ...(labelTabs ? { label: tab.title } : {}),
  }));
}

const newline = "\r\n";

/** Plain text for an export. A lone Document tab stays a bare body. */
export function exportTabsPlainText(sections: LabeledExportTab[]): string {
  if (sections.length === 1 && !sections[0]?.label)
    return documentPlainText(sections[0].content);
  const body = sections
    .map((section) => {
      const text = documentPlainText(section.content).replace(/^\ufeff/, "");
      if (!section.label) return text;
      return `${newline}${section.label}${newline}${newline}${text}`;
    })
    .join(newline);
  return "\ufeff" + body.replace(/(?:\r\n)+$/, "");
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

/** HTML body: a heading for each labeled tab, then that tab's HTML. */
export function exportTabsBodyHtml(
  sections: LabeledExportTab[],
  render: (content: JsonNode, index: number) => string,
): string {
  return sections
    .map((section, index) => {
      const body = render(section.content, index);
      return section.label ? `<h1>${escapeHtml(section.label)}</h1>${body}` : body;
    })
    .join("");
}

/**
 * Document properties that stay with the file when the body is undone.
 */

export type DocumentProperties = {
  author: string;
  subject: string;
  keywords: string[];
  description: string;
  category: string;
};

export function documentProperties(file: { properties?: unknown }): DocumentProperties | null {
  const value = file.properties;
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<DocumentProperties>;
  if (typeof row.author !== "string" || typeof row.subject !== "string" || !Array.isArray(row.keywords))
    return null;
  if (row.keywords.some((keyword) => typeof keyword !== "string")) return null;
  const description = typeof row.description === "string" ? row.description : "";
  const category = typeof row.category === "string" ? row.category : "";
  return {
    author: row.author,
    subject: row.subject,
    keywords: [...row.keywords],
    description,
    category,
  };
}

/** Restore an earlier body and keep the file's current properties. */
export function undoDocument<T extends { content: unknown; properties?: DocumentProperties }>(
  file: T,
  previousContent: unknown,
): T {
  return {
    ...file,
    content: structuredClone(previousContent),
    properties: file.properties
      ? {
          ...file.properties,
          keywords: [...file.properties.keywords],
          description: file.properties.description ?? "",
          category: file.properties.category ?? "",
        }
      : file.properties,
  };
}

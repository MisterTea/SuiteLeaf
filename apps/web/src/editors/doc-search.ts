export type SearchOptions = {
  matchCase: boolean;
  regex: boolean;
  ignoreDiacritics: boolean;
};
export type TextMatch = { from: number; to: number };

// Map normalized characters back to the original UTF-16 positions so accented
// text and surrogate pairs keep correct editor selections and replacement ranges.
function searchable(text: string, ignoreDiacritics: boolean) {
  let value = "";
  const starts: number[] = [],
    ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const normalized = ignoreDiacritics
      ? character.normalize("NFD").replace(/\p{M}/gu, "")
      : character;
    if (!normalized && ends.length)
      ends[ends.length - 1] = offset + character.length;
    for (let i = 0; i < normalized.length; i++) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    value += normalized;
    offset += character.length;
  }
  return { value, starts, ends };
}

export function searchText(
  text: string,
  query: string,
  options: SearchOptions,
): {
  matches: TextMatch[];
  error?: string;
} {
  if (!query) return { matches: [] };
  const input = searchable(text, options.ignoreDiacritics);
  const normalizedQuery = searchable(query, options.ignoreDiacritics).value;
  if (!normalizedQuery) return { matches: [] };
  const pattern = options.regex
    ? normalizedQuery
    : normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let expression: RegExp;
  try {
    expression = new RegExp(pattern, options.matchCase ? "gu" : "giu");
  } catch {
    return { matches: [], error: "Enter a valid regular expression." };
  }
  const matches: TextMatch[] = [];
  for (const match of input.value.matchAll(expression)) {
    // Empty regex matches cannot be selected or replaced as found text.
    if (!match[0].length) continue;
    matches.push({
      from: input.starts[match.index],
      to: input.ends[match.index + match[0].length - 1],
    });
  }
  return { matches };
}

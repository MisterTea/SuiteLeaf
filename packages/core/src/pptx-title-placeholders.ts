/**
 * `showSpecialPlsOnTitleSld="0"` hides the date, footer, and slide number on a
 * layout whose type is `title`. `titleOnly` still shows them.
 */
export function hidesTitleSpecialPlaceholders(
  presentationXml: string,
  layoutXml: string | undefined,
): boolean {
  const flag = /\bshowSpecialPlsOnTitleSld="([^"]*)"/.exec(presentationXml)?.[1];
  if (flag !== "0" && flag !== "false") return false;
  const open = /<p:sldLayout\b([^>]*)>/.exec(layoutXml || "")?.[1] ?? "";
  return /\btype="title"(?!\w)/.test(open);
}

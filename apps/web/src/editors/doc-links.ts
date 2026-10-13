import { safeLink } from "@suiteleaf/core";

/**
 * Turns what someone typed into the link dialog into a safe href, or null.
 * Like Google Docs, a bare web address gets https:// and a bare email address
 * gets mailto:; anything else must already pass `safeLink`.
 */
export function linkTarget(input: string): string | null {
  const url = input.trim();
  if (!url || /\s/.test(url)) return null;
  if (safeLink(url)) return url;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(url)) return `mailto:${url}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(url)) return `https://${url}`;
  return null;
}

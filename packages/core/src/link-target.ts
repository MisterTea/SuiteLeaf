export function safeLink(url: string): boolean {
  return /^(https?:|mailto:|tel:|#)/i.test(url);
}
/**
 * Turns what someone typed into a link into a safe href, or null.
 * A bare web address gets https:// and a bare email address gets mailto:;
 * anything else must already pass `safeLink`. Docs and Sheets share this.
 */
export function linkTarget(input: string): string | null {
  const url = input.trim();
  if (!url || /\s/.test(url)) return null;
  if (safeLink(url)) return url;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(url)) return `mailto:${url}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(url))
    return `https://${url}`;
  return null;
}

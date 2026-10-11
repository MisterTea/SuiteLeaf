/**
 * Internal document anchors ("Linking within a document", WF-A4-22).
 *
 * Pure helpers, so they are unit-testable without a Tiptap instance. SuiteLeaf
 * Tiptap documents allow `#anchor` links (see `safeLink`); a heading's stable
 * slug becomes the anchor id, and an "Link to heading" action inserts a link
 * whose `href` is `#<slug>`.
 */

/** Turn heading text into a deterministic, URL-friendly slug. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "heading";
}

/**
 * Assign a unique slug to a heading, disambiguating collisions with "-1", "-2"…
 * `used` is mutated so subsequent headings avoid the same id. Mirrors the
 * "duplicate content may share a base" behavior but guarantees document-unique
 * ids so a `#anchor` link resolves to exactly one heading.
 */
export function uniqueSlug(
  input: string,
  used: Set<string>,
): { slug: string; taken: boolean } {
  const base = slugify(input);
  if (!used.has(base)) {
    used.add(base);
    return { slug: base, taken: false };
  }
  let n = 1;
  let candidate = `${base}-${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  used.add(candidate);
  return { slug: candidate, taken: true };
}

export function isInternalAnchor(href: string): boolean {
  return /^#[a-z0-9-]*[a-z0-9]$/i.test(href) || href === "#";
}

/** The href used for a link whose target is the heading with `slug`. */
export function anchorHref(slug: string): string {
  return `#${slug}`;
}

/**
 * Assign stable anchor ids to heading nodes that lack one, walking a Tiptap/
 * JSON node tree. In-place mutation; `used` accumulates across the whole
 * document so ids stay unique. Returns the number of ids assigned.
 */
export function assignHeadingAnchors(
  node: { type: string; attrs?: Record<string, unknown>; content?: any[] },
  used: Set<string> = new Set(),
): number {
  let assigned = 0;
  const walk = (n: any): void => {
    if (n?.type === "heading" && n.attrs) {
      const text = plainText(n);
      if (!n.attrs.id || !slugify(String(n.attrs.id))) {
        const { slug } = uniqueSlug(text || "heading", used);
        n.attrs.id = slug;
        assigned += 1;
      } else {
        used.add(String(n.attrs.id));
      }
    }
    for (const c of n?.content ?? []) walk(c);
  };
  walk(node);
  return assigned;
}

function plainText(node: any): string {
  if (node.text != null) return String(node.text);
  return (node.content ?? [])
    .map(plainText)
    .join("")
    .trim();
}

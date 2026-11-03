/** Attributes for an index mark. The notice does not repeat what was typed. */

export type IndexMarkAttrs = { term: string; subentry: string; see: string; seeAlso: string };

function clean(value: string): string {
  return value.replace(/[\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

export function indexMarkAttrs(
  term: string,
  see: string,
  subentry = "",
  seeAlso = "",
): { ok: true; attrs: IndexMarkAttrs } | { ok: false; notice: string } {
  const name = clean(term);
  const target = clean(see);
  const under = clean(subentry);
  const also = clean(seeAlso);
  if (!name) return { ok: false, notice: "Name the index entry." };
  if (
    (target && name.toLocaleLowerCase("en") === target.toLocaleLowerCase("en")) ||
    (also && name.toLocaleLowerCase("en") === also.toLocaleLowerCase("en"))
  ) {
    return { ok: false, notice: "An entry cannot point at itself." };
  }
  if (target && also) return { ok: false, notice: "Use see or see also, not both." };
  return { ok: true, attrs: { term: name, subentry: under, see: target, seeAlso: also } };
}

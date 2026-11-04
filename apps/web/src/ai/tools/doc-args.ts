/** A quoted argument, keeping spaces inside the quotes. */
export function unquoteArg(value: unknown) {
  if (typeof value !== "string") return value;
  const quoted = /^\s*["“]([\s\S]*)["”]\s*$/.exec(value);
  return quoted ? quoted[1] : value;
}

export function flagArg(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (["true", "yes", "1", "all"].includes(text)) return true;
  if (["false", "no", "0"].includes(text)) return false;
  return undefined;
}

export const present = (value?: string) => (value && value.trim() ? value : undefined);

export function firstString(args: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function unwrapName(value: string) {
  return value.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
}

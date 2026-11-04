export function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

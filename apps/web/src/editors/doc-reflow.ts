/** Screen layout only: saved paper settings still drive page setup and print. */
export function documentReflows(content: Element): boolean {
  return getComputedStyle(content).getPropertyValue("--doc-reflow").trim() === "1";
}

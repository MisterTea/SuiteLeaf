/** Slides text editor mode; defaults to Tiptap unless opted out via ?slideText=legacy. */
export function slideTextTrialEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return new URLSearchParams(window.location.search).get("slideText") !== "legacy";
}

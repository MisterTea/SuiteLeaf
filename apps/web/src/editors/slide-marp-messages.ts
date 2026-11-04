export const MARP_UNSUPPORTED =
  "Markdown cannot describe that change, so it was not made. Make it in the markdown instead.";
export const MARP_OUT_OF_STEP =
  "The slides are still being laid out from the markdown. Try again in a moment.";
export const MARP_FIX_FIRST = "Fix the markdown first. The slides update once it is valid.";
export const MARP_THEME_PART =
  "That part comes from the theme, not the markdown, so it cannot be changed here.";
export const MARP_HTML =
  "That line has HTML the editor cannot rewrite. Make the change in the markdown instead.";
export const MARP_CANNOT_WRITE =
  "That edit could not be written into the markdown. Make it in the markdown instead.";

export type Failure = { error: string };

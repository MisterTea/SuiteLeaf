/**
 * What has been checked for keyboard, reading, zoom, contrast, motion, and touch.
 * `partial` means some code exists and was not exercised as a full workflow.
 * `untested` means that combination was not checked. This is not a WCAG claim.
 */

export type AccessMode =
  | "keyboard"
  | "screen-reader"
  | "zoom"
  | "high-contrast"
  | "reduced-motion"
  | "touch";

export type AccessPlatform = "web" | "desktop";

export type AccessStatus = "untested" | "partial";

export type AccessCell = {
  mode: AccessMode;
  platform: AccessPlatform;
  status: AccessStatus;
  note: string;
};

const MODES: AccessMode[] = [
  "keyboard",
  "screen-reader",
  "zoom",
  "high-contrast",
  "reduced-motion",
  "touch",
];

const NOTES: Record<AccessMode, { web: AccessCell; desktop: AccessCell }> = {
  keyboard: {
    web: {
      mode: "keyboard",
      platform: "web",
      status: "partial",
      note: "Accessibility notes are buttons. A full create, edit, save, and share pass with only the keyboard was not run.",
    },
    desktop: {
      mode: "keyboard",
      platform: "desktop",
      status: "untested",
      note: "The desktop window was not used. It loads this web client.",
    },
  },
  "screen-reader": {
    web: {
      mode: "screen-reader",
      platform: "web",
      status: "untested",
      note: "No screen reader was used.",
    },
    desktop: {
      mode: "screen-reader",
      platform: "desktop",
      status: "untested",
      note: "No screen reader was used on the desktop window.",
    },
  },
  zoom: {
    web: {
      mode: "zoom",
      platform: "web",
      status: "untested",
      note: "Page zoom and reflow were not checked.",
    },
    desktop: {
      mode: "zoom",
      platform: "desktop",
      status: "untested",
      note: "Page zoom was not checked in the desktop window.",
    },
  },
  "high-contrast": {
    web: {
      mode: "high-contrast",
      platform: "web",
      status: "partial",
      note: "prefers-contrast: more sets black text, a white surface, and a black border in style.css.",
    },
    desktop: {
      mode: "high-contrast",
      platform: "desktop",
      status: "untested",
      note: "The desktop window was not switched to higher contrast. It loads this web client.",
    },
  },
  "reduced-motion": {
    web: {
      mode: "reduced-motion",
      platform: "web",
      status: "partial",
      note: "prefers-reduced-motion: reduce turns off slide entrance and deck transition animations.",
    },
    desktop: {
      mode: "reduced-motion",
      platform: "desktop",
      status: "untested",
      note: "Reduced motion was not checked in the desktop window. It loads this web client.",
    },
  },
  touch: {
    web: {
      mode: "touch",
      platform: "web",
      status: "untested",
      note: "Touch was not checked.",
    },
    desktop: {
      mode: "touch",
      platform: "desktop",
      status: "untested",
      note: "Touch was not checked in the desktop window.",
    },
  },
};

export function accessMatrix(): AccessCell[] {
  return MODES.flatMap((mode) => [NOTES[mode].web, NOTES[mode].desktop]);
}

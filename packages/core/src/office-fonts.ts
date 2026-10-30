import { officeLineGrid } from "./office-line-grid";
import { OFFICE_TO_SUITELEAF, SUITELEAF_TO_OFFICE } from "./office-font-names";

/** The installed family that lays out text the way the named Office font does; other names stay as they are. */
export function suiteLeafFont(name: string): string;
export function suiteLeafFont(name: string | undefined): string | undefined;
export function suiteLeafFont(name: string | undefined) {
  return name === undefined ? undefined : (OFFICE_TO_SUITELEAF[name.trim()] ?? name);
}

/** The Office font an installed family stands in for, so files written for Office name fonts Office has. */
export function officeFont(name: string): string;
export function officeFont(name: string | undefined): string | undefined;
export function officeFont(name: string | undefined) {
  return name === undefined ? undefined : (SUITELEAF_TO_OFFICE[name.trim()] ?? name);
}

/**
 * PowerPoint single spacing is the font's Windows line grid, not one em.
 * A stored multiple of 1 is 100% of that grid.
 */
export function officeSingleSpacing(font: string | undefined): number {
  if (!font) return 1;
  const name = font.trim();
  return officeLineGrid[name] ?? officeLineGrid[suiteLeafFont(name) ?? ""] ?? 1;
}

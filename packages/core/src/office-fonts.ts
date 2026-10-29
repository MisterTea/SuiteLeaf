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

/** Decisions for phone taps on a sheet. A short press chooses a cell. */

export type ScreenPoint = { x: number; y: number };

export type ScreenBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Movement past this, in screen pixels, is a scroll rather than a tap. */
export const PHONE_TAP_SLOP = 10;

export function pointerScrolled(
  down: ScreenPoint | null,
  up: ScreenPoint,
  slop = PHONE_TAP_SLOP,
): boolean {
  if (!down) return true;
  return Math.hypot(up.x - down.x, up.y - down.y) > slop;
}

export function pointInBox(point: ScreenPoint, box: ScreenBox): boolean {
  return (
    point.x >= box.left &&
    point.x <= box.right &&
    point.y >= box.top &&
    point.y <= box.bottom
  );
}

export type CheckboxSnap = { row: number; col: number; on: boolean };

/**
 * Value to write when a phone pointer-up should flip a checkbox.
 * Univer draws the tick only when the cell equals the rule's checked value,
 * and toggles that value on pointer down when the tap hits its box.
 * A gesture that already toggled the box, including the first selection of
 * that cell, is not written again. A tap that misses the box on an
 * already-selected cell still flips it. A scroll leaves the cell alone.
 */
export function phoneCheckboxWrite(input: {
  before: CheckboxSnap | null;
  after: CheckboxSnap | null;
  scrolled: boolean;
  tapOnCell: boolean;
  alreadyToggled?: boolean;
  checked: string | number | boolean;
  unchecked: string | number | boolean;
}): { v: string | number | boolean; p: null } | null {
  const {
    before,
    after,
    scrolled,
    tapOnCell,
    alreadyToggled = false,
    checked,
    unchecked,
  } = input;
  if (!after || scrolled || alreadyToggled) return null;
  if (
    before &&
    before.row === after.row &&
    before.col === after.col &&
    (before.on !== after.on || !tapOnCell)
  )
    return null;
  return { v: after.on ? unchecked : checked, p: null };
}

/**
 * A phone opens the header filter only for a tap on that header cell.
 * A scroll, or a finger lift that was not on the header, leaves it closed.
 */
export function shouldOpenPhoneHeaderFilter(input: {
  narrow: boolean;
  singleHeaderCell: boolean;
  down: ScreenPoint | null;
  up: ScreenPoint;
  headerBox: ScreenBox | null;
}): boolean {
  const { narrow, singleHeaderCell, down, up, headerBox } = input;
  if (!narrow || !singleHeaderCell || !headerBox || !down) return false;
  if (pointerScrolled(down, up)) return false;
  return pointInBox(down, headerBox) && pointInBox(up, headerBox);
}

const FILTER_CONTROL = 'label[data-u-comp="checkbox"], a, button, input';

/**
 * Checkbox to tick when a filter value's name or count is clicked.
 * On a phone the name itself is the flex box, and the checkbox is the
 * sibling before it. The checkbox, a link, a button, or an input keeps
 * its own click. A date group starts with an expand arrow and keeps expanding.
 */
export function checkboxForFilterLabel(target: Element): HTMLInputElement | null {
  if (target.closest(FILTER_CONTROL)) return null;
  const desktop = target.closest('[data-u-comp="sheets-filter-panel"]');
  if (desktop) {
    const row = target.closest('div:has(> label[data-u-comp="checkbox"])');
    if (!row || row.firstElementChild?.tagName !== "LABEL") return null;
    return row.querySelector<HTMLInputElement>("input[type=checkbox]");
  }
  const line = target.closest(
    '[data-u-comp="mobile-sheets-filter-by-values"] .univer-flex',
  );
  if (!line) return null;
  const nested = line.querySelector<HTMLInputElement>(
    'label[data-u-comp="checkbox"] input[type=checkbox]',
  );
  if (nested) return nested;
  const row = line.parentElement;
  if (!row || row.firstElementChild?.tagName !== "LABEL") return null;
  let sibling: Element | null = line.previousElementSibling;
  while (sibling) {
    if (sibling.matches('label[data-u-comp="checkbox"]'))
      return sibling.querySelector<HTMLInputElement>("input[type=checkbox]");
    sibling = sibling.previousElementSibling;
  }
  return null;
}

/**
 * Format › Rotate text, in the angles this sheet grid paints.
 *
 * Univer applies `tr.a` with canvas rotation, and a positive canvas angle
 * is clockwise, so rotate-up is -90 and rotate-down is 90. Stacked text is
 * not a number: `setTextRotation` stores `{ a: 0, v: 1 }` for any other value.
 * Null clears rotation and leaves wrap alone.
 */
export const sheetTextRotation = {
  tiltCounterclockwise: -45,
  tiltClockwise: 45,
  up: -90,
  down: 90,
  vertical: { a: 0, v: 1 } as const,
  none: null,
};

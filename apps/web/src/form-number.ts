/** A number answer. The stored text is the number that was written. */

export function formNumberAnswer(
  value: string,
  min?: number,
  max?: number,
): { text: string } | { message: string } {
  const text = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return { message: "Enter a number." };
  const number = Number(text);
  if (!Number.isFinite(number)) return { message: "Enter a number." };
  const low = typeof min === "number" && Number.isFinite(min) ? min : undefined;
  const high = typeof max === "number" && Number.isFinite(max) ? max : undefined;
  if (low !== undefined && high !== undefined && low > high) {
    return { message: "That number range is not valid." };
  }
  if ((low !== undefined && number < low) || (high !== undefined && number > high)) {
    return { message: "That number is outside the range." };
  }
  return { text };
}

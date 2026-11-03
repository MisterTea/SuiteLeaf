/** A listed choice, compared after trimming. The stored answer is the trimmed choice. */

export function listedChoice(choices: string[] | undefined, value: string): string | null {
  const answer = value.trim();
  if (!answer) return null;
  const match = (choices ?? []).find((choice) => choice.trim() === answer);
  return match ? match.trim() : null;
}

export function choiceAnswerError(
  prompt: string,
  required: boolean,
  choices: string[] | undefined,
  value: string,
): string | null {
  const answer = value.trim();
  const label = prompt || "This question";
  if (!answer) return required ? `${label} is required` : null;
  if (!listedChoice(choices, value)) return `${label} must be one of the choices`;
  return null;
}

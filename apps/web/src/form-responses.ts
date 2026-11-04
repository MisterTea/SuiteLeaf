/**
 * Rows for an authorized export of form responses.
 * A question is named by its id and version. An answer that looks like a
 * spreadsheet formula is text. This is not a public form payload.
 */

export type FormQuestionExport = { id: string; version: string };
export type FormResponseExport = { id: string; answers: Record<string, string> };

const CREDENTIAL = /secret|password|token|api[_-]?key/i;

function questionHeader(question: FormQuestionExport, index: number): string {
  const name = `${question.id}@${question.version}`.trim();
  if (!question.id.trim() || !question.version.trim() || CREDENTIAL.test(name)) return `question ${index + 1}`;
  return name;
}

/** A leading =, +, -, or @ would be a formula in a spreadsheet. */
export function formAnswerText(value: string): string {
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

/**
 * One header row, then one row per response. A repeated response id is kept once.
 * The lists passed in are not changed.
 */
export function formResponseRows(
  questions: readonly FormQuestionExport[],
  responses: readonly FormResponseExport[],
): { rows: string[][]; notice: string } {
  const header = ["response", ...questions.map(questionHeader)];
  const rows = [header];
  const seen = new Set<string>();
  let repeated = 0;
  for (const response of responses) {
    if (seen.has(response.id)) {
      repeated += 1;
      continue;
    }
    seen.add(response.id);
    rows.push([
      CREDENTIAL.test(response.id) ? "response" : response.id,
      ...questions.map((question) => formAnswerText(response.answers[question.id] ?? "")),
    ]);
  }
  const notice =
    repeated === 0 ? "Every response was exported once." : `${repeated} repeated response was kept once.`;
  return { rows, notice };
}

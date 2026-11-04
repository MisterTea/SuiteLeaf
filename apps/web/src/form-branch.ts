/** Which questions a respondent sees. A branch jumps forward. It does not jump backward. */

export type FormBranch = { when: string; next: string };

export type BranchQuestion = {
  id: string;
  branches?: FormBranch[];
};

export function visibleQuestionIds(
  questions: readonly BranchQuestion[],
  answers: Record<string, string>,
): string[] {
  const indexOf = new Map(
    questions.flatMap((question, index) => (question ? [[question.id, index] as const] : [])),
  );
  const ids: string[] = [];
  let index = 0;
  while (index < questions.length) {
    const question = questions[index];
    if (!question) break;
    ids.push(question.id);
    const answer = (answers[question.id] ?? "").trim();
    const jump = question.branches?.find((branch) => branch.when.trim() === answer);
    const next = jump ? indexOf.get(jump.next) : undefined;
    index = next !== undefined && next > index ? next : index + 1;
  }
  return ids;
}

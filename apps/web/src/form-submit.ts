/** A response added by someone who cannot edit the questions. The question list is kept. */

export function keepFormQuestions<Q extends { id: string }, R extends { answers: Record<string, string> }>(
  questions: readonly Q[],
  responses: readonly R[],
  next: R,
): { questions: Q[]; responses: R[] } {
  const allowed = new Set(questions.map((question) => question.id));
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(next.answers)) {
    if (allowed.has(key)) answers[key] = value;
  }
  return {
    questions: questions.map((question) => question),
    responses: [...responses, { ...next, answers }],
  };
}

/** Append one response and keep every other field on the form, including the title. */
export function appendFormResponse<
  Q extends { id: string },
  R extends { answers: Record<string, string> },
  C extends { questions: readonly Q[]; responses: readonly R[] },
>(content: C, next: R): C {
  const stored = keepFormQuestions(content.questions, content.responses, next);
  return { ...content, questions: stored.questions, responses: stored.responses };
}

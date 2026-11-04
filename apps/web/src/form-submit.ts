/** A response added by someone who cannot edit the questions. The question list is kept. */

export function keepFormQuestions<
  Q extends { id: string },
  R extends { id: string; answers: Record<string, string> },
>(
  questions: readonly Q[],
  responses: readonly R[],
  next: R,
): { questions: Q[]; responses: R[] } {
  const allowed = new Set(questions.map((question) => question.id));
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(next.answers)) {
    if (allowed.has(key)) answers[key] = value;
  }
  const stored = responses.some((response) => response.id === next.id)
    ? [...responses]
    : [...responses, { ...next, answers }];
  return {
    questions: questions.map((question) => question),
    responses: stored,
  };
}

/** Missing `accepting` means the form is still open. */
export function formClosedMessage(content: { accepting?: boolean }): string | null {
  return content.accepting === false ? "This form is not taking more responses." : null;
}

/** A deadline that is not a time does not close the form. */
export function formDeadlineMessage(deadline: string | undefined, now: Date): string | null {
  if (!deadline?.trim()) return null;
  const time = Date.parse(deadline);
  if (!Number.isFinite(time)) return null;
  return now.getTime() >= time ? "The deadline for this form has passed." : null;
}

/** Append one response and keep every other field on the form, including the title. */
export function appendFormResponse<
  Q extends { id: string },
  R extends { id: string; answers: Record<string, string> },
  C extends { accepting?: boolean; deadline?: string; questions: readonly Q[]; responses: readonly R[] },
>(content: C, next: R, now = new Date()): C {
  if (formClosedMessage(content) || formDeadlineMessage(content.deadline, now)) return { ...content };
  const stored = keepFormQuestions(content.questions, content.responses, next);
  return { ...content, questions: stored.questions, responses: stored.responses };
}

/** Points for the questions a respondent can see. A skipped question is not scored. */

import { visibleQuestionIds, type BranchQuestion } from "./form-branch";

export type ScoredQuestion = BranchQuestion & {
  points?: number;
  answer?: string;
};

export function formScore(
  questions: readonly ScoredQuestion[],
  answers: Record<string, string>,
): { score: number; possible: number } {
  const visible = new Set(visibleQuestionIds(questions, answers));
  let score = 0;
  let possible = 0;
  for (const question of questions) {
    if (!visible.has(question.id)) continue;
    const points = question.points;
    if (typeof points !== "number" || !Number.isInteger(points) || points < 1 || points > 1000) continue;
    possible += points;
    if ((answers[question.id] ?? "").trim() === (question.answer ?? "").trim() && question.answer?.trim()) {
      score += points;
    }
  }
  return { score, possible };
}

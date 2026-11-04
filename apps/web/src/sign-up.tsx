import { useEffect, useState } from "react";
import {
  loadSignUp,
  submitSignUp,
  type PublicForm,
  type PublicQuestion,
} from "./node-client";
import { visibleQuestionIds } from "./form-branch";
import { formNumberAnswer } from "./form-number";
import { formUploadText } from "./form-upload";
import { formClosedMessage, formDeadlineMessage } from "./form-submit";
import { choiceAnswerError } from "./form-choice";
import { canonicalGridAnswer, filledLabels, gridAnswerError } from "./form-grid";
import { GridAnswer } from "./form-grid-view";

const RATING_SCORES = ["1", "2", "3", "4", "5"];

function questionError(question: PublicQuestion, value: string): string | null {
  const answer = value.trim();
  const prompt = question.prompt || "This question";
  if (question.kind === "grid") {
    return gridAnswerError(
      prompt,
      question.required,
      filledLabels(question.rows),
      filledLabels(question.columns),
      value,
    );
  }
  if (question.kind === "choice") {
    return choiceAnswerError(prompt, question.required, question.choices, value);
  }
  if (question.kind === "number") {
    if (question.required && !answer) return `${prompt} is required`;
    if (answer) {
      const result = formNumberAnswer(answer, question.min, question.max);
      if ("message" in result) return result.message;
    }
    return null;
  }
  if (question.required && !answer) return `${prompt} is required`;
  if (question.kind === "rating" && answer && !RATING_SCORES.includes(answer)) {
    return `${prompt} must be a rating from 1 to 5`;
  }
  return null;
}

/** A neighbor fills this in. There is no account, no editor, and no other rows. */
export default function SignUpPage({ token }: { token: string }) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [closed, setClosed] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);

  useEffect(() => {
    let cancel = false;
    loadSignUp(token).then(
      (next) => {
        if (!cancel) setForm(next);
      },
      () => {
        if (!cancel) setClosed(true);
      },
    );
    return () => {
      cancel = true;
    };
  }, [token]);

  const submit = async () => {
    if (!form) return;
    const visible = new Set(visibleQuestionIds(form.questions, draft));
    for (const question of form.questions.filter((question) => visible.has(question.id))) {
      const message = questionError(question, draft[question.id] ?? "");
      if (message) {
        setError(message);
        return;
      }
    }
    const answers: Record<string, string> = {};
    for (const question of form.questions.filter((question) => visible.has(question.id))) {
      if (question.kind === "grid") {
        const value = canonicalGridAnswer(
          filledLabels(question.rows),
          filledLabels(question.columns),
          draft[question.id] ?? "",
        );
        if (value) answers[question.id] = value;
      } else {
        if (question.kind === "number") {
          const result = formNumberAnswer(draft[question.id] ?? "", question.min, question.max);
          if ("text" in result && result.text) answers[question.id] = result.text;
        } else {
          const value = (draft[question.id] ?? "").trim();
          if (value) answers[question.id] = value;
        }
      }
    }
    try {
      await submitSignUp(token, answers);
      setReceived(true);
      setError("");
    } catch (e) {
      const message = e instanceof Error ? e.message : "closed";
      if (message === "closed") setClosed(true);
      else setError(message);
    }
  };

  if (closed) {
    return (
      <main className="sign-up-page">
        <p className="sign-up-closed">This sign-up is closed.</p>
      </main>
    );
  }
  const closedMessage = form
    ? formClosedMessage(form) ?? formDeadlineMessage(form.deadline, new Date())
    : null;
  if (closedMessage) {
    return (
      <main className="sign-up-page">
        <p className="sign-up-closed">{closedMessage}</p>
      </main>
    );
  }
  if (!form) {
    return (
      <main className="sign-up-page">
        <p className="form-empty">Opening the sign-up…</p>
      </main>
    );
  }
  if (received) {
    return (
      <main className="sign-up-page">
        <div className="form-editor">
          <h1>{form.title}</h1>
          <p className="sign-up-received">Your sign-up was received.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="sign-up-page">
      <div className="form-editor">
        <h1>{form.title}</h1>
        <form
          className="form-respond"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {form.questions
            .filter((question) => visibleQuestionIds(form.questions, draft).includes(question.id))
            .map((question) => (
            <fieldset key={question.id}>
              <legend>
                {question.prompt || "Untitled question"}
                {question.required ? " (required)" : ""}
              </legend>
              {question.kind === "choice" ? (
                <div role="radiogroup" aria-label={question.prompt || "Choice"}>
                  {(question.choices ?? []).filter((choice) => choice.trim()).map((choice) => (
                    <span key={choice}>
                      <input
                        id={`${question.id}-${choice}`}
                        type="radio"
                        name={question.id}
                        value={choice}
                        checked={draft[question.id] === choice}
                        onChange={() =>
                          setDraft({ ...draft, [question.id]: choice })
                        }
                      />
                      <label htmlFor={`${question.id}-${choice}`}>{choice}</label>
                    </span>
                  ))}
                </div>
              ) : question.kind === "grid" ? (
                <GridAnswer
                  questionId={question.id}
                  rows={filledLabels(question.rows)}
                  columns={filledLabels(question.columns)}
                  value={draft[question.id] ?? ""}
                  onChange={(value) => setDraft({ ...draft, [question.id]: value })}
                />
              ) : question.kind === "rating" ? (
                <div
                  className="form-rating"
                  role="radiogroup"
                  aria-label={question.prompt || "Rating"}
                >
                  {RATING_SCORES.map((score) => (
                    <span key={score}>
                      <input
                        id={`${question.id}-rating-${score}`}
                        type="radio"
                        name={question.id}
                        value={score}
                        checked={draft[question.id] === score}
                        onChange={() =>
                          setDraft({ ...draft, [question.id]: score })
                        }
                      />
                      <label htmlFor={`${question.id}-rating-${score}`}>{score}</label>
                    </span>
                  ))}
                </div>
              ) : question.kind === "number" ? (
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={question.prompt || "Number"}
                  value={draft[question.id] ?? ""}
                  onChange={(event) => setDraft({ ...draft, [question.id]: event.target.value })}
                />
              ) : question.kind === "file" ? (
                <input
                  type="file"
                  aria-label={question.prompt || "File"}
                  onChange={(event) => {
                    const picked = event.target.files?.[0];
                    if (!picked) {
                      setDraft({ ...draft, [question.id]: "" });
                      return;
                    }
                    const result = formUploadText(picked.name, picked.size);
                    if ("message" in result) {
                      setError(result.message);
                      setDraft({ ...draft, [question.id]: "" });
                      return;
                    }
                    setError("");
                    setDraft({ ...draft, [question.id]: `${picked.name.trim()}|${picked.size}` });
                  }}
                />
              ) : (
                <input
                  type="text"
                  aria-label={question.prompt || "Answer"}
                  value={draft[question.id] ?? ""}
                  maxLength={2000}
                  onChange={(e) =>
                    setDraft({ ...draft, [question.id]: e.target.value })
                  }
                />
              )}
            </fieldset>
          ))}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {form.questions.length > 0 ? (
            <button type="submit">Submit</button>
          ) : null}
        </form>
      </div>
    </main>
  );
}

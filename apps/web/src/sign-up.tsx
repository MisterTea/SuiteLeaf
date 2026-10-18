import { useEffect, useState } from "react";
import {
  loadSignUp,
  submitSignUp,
  type PublicForm,
  type PublicQuestion,
} from "./node-client";
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
  if (question.required && !answer) return `${prompt} is required`;
  if (
    question.kind === "choice" &&
    answer &&
    !(question.choices ?? []).includes(answer)
  ) {
    return `${prompt} must be one of the choices`;
  }
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
    for (const question of form.questions) {
      const message = questionError(question, draft[question.id] ?? "");
      if (message) {
        setError(message);
        return;
      }
    }
    const answers: Record<string, string> = {};
    for (const question of form.questions) {
      if (question.kind === "grid") {
        const value = canonicalGridAnswer(
          filledLabels(question.rows),
          filledLabels(question.columns),
          draft[question.id] ?? "",
        );
        if (value) answers[question.id] = value;
      } else {
        const value = (draft[question.id] ?? "").trim();
        if (value) answers[question.id] = value;
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
          {form.questions.map((question) => (
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

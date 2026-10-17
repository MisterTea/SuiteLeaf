import { useEffect, useRef, useState } from "react";
import type { EditorActions } from "../ui";
import type { FormFile } from "@suiteleaf/core";
import { canonicalGridAnswer, filledLabels, gridAnswerError } from "../form-grid";
import { GridAnswer, GridAnswerLines } from "../form-grid-view";

type Question = FormFile["content"]["questions"][number];
type View = "questions" | "respond" | "responses";

const RATING_SCORES = ["1", "2", "3", "4", "5"] as const;

function answerKind(value: string): Question["kind"] {
  if (value === "choice" || value === "rating" || value === "grid") return value;
  return "text";
}

function withKind(question: Question, kind: Question["kind"]): Question {
  return {
    ...question,
    kind,
    choices: kind === "choice" ? question.choices ?? [""] : undefined,
    rows: kind === "grid" ? (question.rows?.length ? question.rows : ["", ""]) : undefined,
    columns:
      kind === "grid" ? (question.columns?.length ? question.columns : ["", ""]) : undefined,
  };
}

function LabelList({
  heading,
  name,
  addLabel,
  values,
  readOnly,
  onChange,
}: {
  heading: string;
  name: string;
  addLabel: string;
  values: string[];
  readOnly?: boolean;
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="form-choices">
      <span className="form-grid-heading">{heading}</span>
      {values.map((value, index) => (
        <input
          key={index}
          aria-label={name}
          value={value}
          maxLength={80}
          disabled={readOnly}
          onChange={(e) => {
            const next = [...values];
            next[index] = e.target.value;
            onChange(next);
          }}
        />
      ))}
      {readOnly ? null : (
        <button type="button" onClick={() => onChange([...values, ""])}>
          {addLabel}
        </button>
      )}
    </div>
  );
}

function blankQuestion(): Question {
  return {
    id: crypto.randomUUID(),
    prompt: "",
    kind: "text",
    required: false,
  };
}

export default function FormEditor({
  file,
  readOnly,
  canSubmit,
  respondOnly = false,
  onChange,
  onActions,
}: {
  file: FormFile;
  readOnly?: boolean;
  /** When set, submit stays available even if the questions are read-only. */
  canSubmit?: boolean;
  /** A responder sees the sign-up form and no other tabs. */
  respondOnly?: boolean;
  onChange: (content: FormFile["content"]) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
}) {
  const allowSubmit = canSubmit ?? !readOnly;
  const [view, setView] = useState<View>(respondOnly ? "respond" : "questions");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [questions, setQuestionsState] = useState(file.content.questions);
  const [responses, setResponsesState] = useState(file.content.responses);
  const written = useRef(JSON.stringify(file.content));
  const responsesRef = useRef(responses);
  responsesRef.current = responses;

  useEffect(() => {
    const incoming = JSON.stringify(file.content);
    if (incoming === written.current) return;
    written.current = incoming;
    setQuestionsState(file.content.questions);
    setResponsesState(file.content.responses);
  }, [file.content]);

  useEffect(() => {
    onActions({
      flush: async () => {},
      export: async () => {
        throw new Error("Download the SuiteLeaf file to keep this form.");
      },
      print: async () => window.print(),
    });
  }, [onActions]);

  const write = (next: FormFile["content"]) => {
    written.current = JSON.stringify(next);
    onChange(next);
  };
  const setQuestions = (next: Question[]) => {
    setQuestionsState(next);
    write({ questions: next, responses: responsesRef.current });
  };

  const submit = () => {
    for (const question of questions) {
      const prompt = question.prompt || "This question";
      if (question.kind === "grid") {
        const message = gridAnswerError(
          prompt,
          question.required,
          filledLabels(question.rows),
          filledLabels(question.columns),
          draft[question.id] ?? "",
        );
        if (message) {
          setError(message);
          return;
        }
      } else if (question.required && !(draft[question.id] ?? "").trim()) {
        setError(`${prompt} is required`);
        return;
      }
    }
    const answers: Record<string, string> = {};
    for (const question of questions) {
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
    const nextResponses = [
      ...responsesRef.current,
      { id: crypto.randomUUID(), at: new Date().toISOString(), answers },
    ];
    setResponsesState(nextResponses);
    write({ questions, responses: nextResponses });
    setDraft({});
    setError("");
    setView("respond");
  };

  const shown: View = respondOnly ? "respond" : view;
  const tabs = respondOnly
    ? ([["respond", "Add a response"]] as const)
    : ([
        ["questions", "Questions"],
        ["respond", "Add a response"],
        ["responses", "Responses"],
      ] as const);

  return (
    <div className="form-editor">
      <div className="form-views" role="tablist" aria-label="Form">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={shown === id}
            className={shown === id ? "selected" : ""}
            onClick={() => {
              setError("");
              setView(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {shown === "questions" ? (
        <div className="form-questions">
          {questions.length === 0 ? (
            <p className="form-empty">Add a question to start the sign-up.</p>
          ) : null}
          {questions.map((question, index) => (
            <fieldset key={question.id} className="form-question">
              <label>
                Question
                <input
                  aria-label="Question"
                  value={question.prompt}
                  maxLength={200}
                  disabled={readOnly}
                  onChange={(e) =>
                    setQuestions(
                      questions.map((q, i) =>
                        i === index ? { ...q, prompt: e.target.value } : q,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Answer type
                <select
                  aria-label={`Answer type for question ${index + 1}`}
                  value={question.kind}
                  disabled={readOnly}
                  onChange={(e) => {
                    const kind = answerKind(e.target.value);
                    setQuestions(
                      questions.map((q, i) => (i === index ? withKind(q, kind) : q)),
                    );
                  }}
                >
                  <option value="text">Short text</option>
                  <option value="choice">One choice</option>
                  <option value="grid">Grid</option>
                  <option value="rating">Rating</option>
                </select>
              </label>
              <span className="form-required">
                <input
                  id={`required-${question.id}`}
                  type="checkbox"
                  checked={question.required}
                  disabled={readOnly}
                  onChange={(e) =>
                    setQuestions(
                      questions.map((q, i) =>
                        i === index ? { ...q, required: e.target.checked } : q,
                      ),
                    )
                  }
                />
                <label htmlFor={`required-${question.id}`}>Required</label>
              </span>
              {question.kind === "choice" ? (
                <div className="form-choices">
                  {(question.choices ?? [""]).map((choice, choiceIndex) => (
                    <input
                      key={choiceIndex}
                      aria-label="Choice"
                      value={choice}
                      maxLength={80}
                      disabled={readOnly}
                      onChange={(e) => {
                        const choices = [...(question.choices ?? [""])];
                        choices[choiceIndex] = e.target.value;
                        setQuestions(
                          questions.map((q, i) =>
                            i === index ? { ...q, choices } : q,
                          ),
                        );
                      }}
                    />
                  ))}
                  {readOnly ? null : (
                    <button
                      type="button"
                      onClick={() =>
                        setQuestions(
                          questions.map((q, i) =>
                            i === index
                              ? { ...q, choices: [...(q.choices ?? []), ""] }
                              : q,
                          ),
                        )
                      }
                    >
                      Add choice
                    </button>
                  )}
                </div>
              ) : question.kind === "grid" ? (
                <div className="form-grid-editor">
                  <LabelList
                    heading="Rows"
                    name="Row"
                    addLabel="Add row"
                    values={question.rows ?? ["", ""]}
                    readOnly={readOnly}
                    onChange={(rows) =>
                      setQuestions(
                        questions.map((q, i) => (i === index ? { ...q, rows } : q)),
                      )
                    }
                  />
                  <LabelList
                    heading="Columns"
                    name="Column"
                    addLabel="Add column"
                    values={question.columns ?? ["", ""]}
                    readOnly={readOnly}
                    onChange={(columns) =>
                      setQuestions(
                        questions.map((q, i) => (i === index ? { ...q, columns } : q)),
                      )
                    }
                  />
                </div>
              ) : null}
            </fieldset>
          ))}
          {readOnly ? null : (
            <button type="button" onClick={() => setQuestions([...questions, blankQuestion()])}>
              Add question
            </button>
          )}
        </div>
      ) : null}

      {shown === "respond" ? (
        <form
          className="form-respond"
          onSubmit={(e) => {
            e.preventDefault();
            if (allowSubmit) submit();
          }}
        >
          {questions.length === 0 ? (
            <p className="form-empty">Add a question before collecting answers.</p>
          ) : (
            questions.map((question) => (
              <fieldset key={question.id}>
                <legend>
                  {question.prompt || "Untitled question"}
                  {question.required ? " (required)" : ""}
                </legend>
                {question.kind === "choice" ? (
                  <div role="radiogroup" aria-label={question.prompt || "Choice"}>
                    {(question.choices ?? []).filter((c) => c.trim()).map((choice) => (
                      <span key={choice}>
                        <input
                          id={`${question.id}-${choice}`}
                          type="radio"
                          name={question.id}
                          value={choice}
                          checked={draft[question.id] === choice}
                          disabled={!allowSubmit}
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
                    disabled={!allowSubmit}
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
                          disabled={!allowSubmit}
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
                    aria-label={question.prompt || "Answer"}
                    value={draft[question.id] ?? ""}
                    maxLength={2000}
                    disabled={!allowSubmit}
                    onChange={(e) =>
                      setDraft({ ...draft, [question.id]: e.target.value })
                    }
                  />
                )}
              </fieldset>
            ))
          )}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {questions.length > 0 && allowSubmit ? (
            <button type="submit">Submit response</button>
          ) : null}
        </form>
      ) : null}

      {shown === "responses" ? (
        <div className="form-responses">
          {responses.length === 0 ? (
            <p className="form-empty">No one has signed up yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {questions.map((question) => (
                    <th key={question.id} scope="col">
                      {question.prompt || "Untitled question"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.map((response) => (
                  <tr key={response.id}>
                    {questions.map((question) => (
                      <td
                        key={question.id}
                        className={question.kind === "grid" ? "form-grid-answer" : undefined}
                      >
                        {question.kind === "grid" ? (
                          <GridAnswerLines
                            rows={filledLabels(question.rows)}
                            value={response.answers[question.id] ?? ""}
                          />
                        ) : (
                          response.answers[question.id] ?? ""
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}

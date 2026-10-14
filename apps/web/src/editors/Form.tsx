import { useEffect, useRef, useState } from "react";
import type { EditorActions } from "../ui";
import type { FormFile } from "@suiteleaf/core";

type Question = FormFile["content"]["questions"][number];
type View = "questions" | "respond" | "responses";

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
      const value = (draft[question.id] ?? "").trim();
      if (question.required && !value) {
        setError(`${question.prompt || "This question"} is required`);
        return;
      }
    }
    const answers: Record<string, string> = {};
    for (const question of questions) {
      const value = (draft[question.id] ?? "").trim();
      if (value) answers[question.id] = value;
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
                    const kind = e.target.value === "choice" ? "choice" : "text";
                    setQuestions(
                      questions.map((q, i) =>
                        i === index
                          ? {
                              ...q,
                              kind,
                              choices:
                                kind === "choice" ? q.choices ?? [""] : undefined,
                            }
                          : q,
                      ),
                    );
                  }}
                >
                  <option value="text">Short text</option>
                  <option value="choice">One choice</option>
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
                      <td key={question.id}>{response.answers[question.id] ?? ""}</td>
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

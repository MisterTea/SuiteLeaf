import { useEffect, useRef, useState } from "react";
import { generateMailText, type MailAiTask } from "./assistant";
import { AssistantOptIn, AssistantSettings } from "../ai/assistant-settings";
export function MailAssistant({
  text,
  onInsert,
}: {
  text: string;
  onInsert?: (text: string) => void;
}) {
  const [task, setTask] = useState<MailAiTask>(
      onInsert ? "compose" : "summarize",
    ),
    [instruction, setInstruction] = useState(""),
    [suggestion, setSuggestion] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  return (
    <details className="mail-ai">
      <summary>SuiteLeaf writing assistant</summary>
      <AssistantOptIn />
      <AssistantSettings />
      <p>
        Uses your existing assistant settings. Only generate when you want this
        content sent to the configured model. Review the suggestion before using
        it.
      </p>
      <label>
        Writing task
        <select
          value={task}
          onChange={(e) => setTask(e.target.value as MailAiTask)}
        >
          <option value="compose">Draft email</option>
          <option value="reply">Suggest a reply</option>
          <option value="translate">Translate</option>
          <option value="summarize">Summarize</option>
        </select>
      </label>
      <label>
        Instructions (include a language for translation)
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const abort = new AbortController();
          controller.current = abort;
          setBusy(true);
          setError("");
          void generateMailText(task, text, instruction, abort.signal)
            .then(setSuggestion)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Generate suggestion
      </button>
      {busy && (
        <button type="button" onClick={() => controller.current?.abort()}>
          Cancel suggestion
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {suggestion && (
        <div>
          <pre>{suggestion}</pre>
          {onInsert && (
            <button type="button" onClick={() => onInsert(suggestion)}>
              Use suggestion
            </button>
          )}
          <button type="button" onClick={() => setSuggestion("")}>
            Discard suggestion
          </button>
        </div>
      )}
    </details>
  );
}

import { useSyncExternalStore } from "react";
import { AI_MODELS } from "@suiteleaf/core/ai";
import { useMode } from "../mode";
import { completionsUrl } from "./openai-completions";
import { readAiPreferences, readModelName, writeAiPreferences, onAiPreferencesChanged, type AiPlace } from "./preferences";

function useAiPreferences() {
  return useSyncExternalStore(onAiPreferencesChanged, readAiPreferences);
}

/** Where the header says the assistant is running. */
export function assistantWhere(demo: boolean, cluster: boolean): string {
  if (demo) return "in this browser";
  const prefs = readAiPreferences();
  if (prefs.place === "remote") {
    try {
      return new URL(completionsUrl(prefs.endpoint)).host;
    } catch {
      return "a remote endpoint";
    }
  }
  if (cluster) return "on the server";
  if (window.suiteleaf?.ai) return "on this computer";
  return "on the server";
}

/** The name shown on the panel. Built-in models use their short name; anything else is shown as typed. */
export function assistantLabel(): string {
  const name = readModelName();
  return name in AI_MODELS ? AI_MODELS[name as keyof typeof AI_MODELS].short : name;
}

/** Serverless mode keeps the in-page model and does not offer this choice. */
export function AssistantSettings() {
  const { demo, mode } = useMode();
  const prefs = useAiPreferences();
  if (demo) return null;
  const cluster = mode.kind === "cluster";
  const onComputer = !cluster && !!window.suiteleaf?.ai;
  const placeLabel = cluster || !onComputer ? "On the server" : "On this computer";
  const hint = prefs.place === "remote"
    ? "SuiteLeaf sends each prompt to this endpoint's /v1/completions API. FrogNano is the model name unless you change it."
    : onComputer
      ? "The first time you ask the assistant, SuiteLeaf downloads the selected model to this computer if it is not already here, then runs it."
      : "The first time you ask the assistant, this server downloads the selected model if it is not already there. A server with its own model endpoint uses that instead.";
  return (
    <details className="agent-setup">
      <summary>Assistant settings</summary>
      <fieldset>
        <legend>Where the assistant runs</legend>
        <label>
          <input
            type="radio"
            name="ai-place"
            checked={prefs.place === "server"}
            onChange={() => writeAiPreferences({ place: "server" satisfies AiPlace })}
          />
          {placeLabel}
        </label>
        <label>
          <input
            type="radio"
            name="ai-place"
            checked={prefs.place === "remote"}
            onChange={() => writeAiPreferences({ place: "remote" })}
          />
          OpenAI-compatible endpoint
        </label>
      </fieldset>
      <label>
        Model
        <input
          aria-label="Model"
          list="suiteleaf-ai-models"
          value={prefs.model}
          spellCheck={false}
          onChange={(event) => writeAiPreferences({ model: event.target.value })}
          onBlur={() => {
            if (!readModelName()) writeAiPreferences({ model: "frognano-4b" });
          }}
        />
        <datalist id="suiteleaf-ai-models">
          <option value="frognano-4b" />
          <option value="gemma-4-e4b" />
          <option value="muse-glimmer-30b" />
        </datalist>
      </label>
      {prefs.place === "remote" ? (
        <>
          <label>
            Endpoint
            <input
              aria-label="Endpoint"
              type="url"
              placeholder="http://127.0.0.1:8080/v1"
              value={prefs.endpoint}
              spellCheck={false}
              onChange={(event) => writeAiPreferences({ endpoint: event.target.value })}
            />
          </label>
          <label>
            API key
            <input
              aria-label="API key"
              type="password"
              autoComplete="off"
              value={prefs.apiKey}
              onChange={(event) => writeAiPreferences({ apiKey: event.target.value })}
            />
          </label>
        </>
      ) : null}
      <p>{hint}</p>
    </details>
  );
}

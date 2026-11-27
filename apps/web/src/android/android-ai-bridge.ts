import type {
  AiBridge,
  AiGenerateEvent,
  AiGenerateRequest,
  AiStatus,
} from "@suiteleaf/core/ai";
import type {
  NativeAiCoreEvent,
  NativeAiCoreStatus,
  SuiteLeafAndroidNativePlugin,
} from "./native-plugin";

export const AICORE_MODEL_ID = "aicore-full" as const;
export const AICORE_MODEL_LABEL = "Gemini Nano (AICore Full)";

function toAiStatus(native: NativeAiCoreStatus): AiStatus {
  return {
    state: native.state,
    backend: "aicore",
    modelId: AICORE_MODEL_ID,
    model: AICORE_MODEL_LABEL,
    progress: native.progress,
    message: native.message,
    loadMs: native.loadMs,
  };
}

/**
 * Exposes Android AICore (ML Kit GenAI Prompt API, ModelPreference.FULL)
 * through SuiteLeaf's `AiBridge` interface (`window.suiteleaf.ai`).
 */
export function createAndroidAiBridge(plugin: SuiteLeafAndroidNativePlugin): AiBridge {
  const statusListeners = new Set<(status: AiStatus) => void>();
  const activeGenerations = new Map<
    string,
    {
      stop: string[];
      accumulated: string;
      aborted: boolean;
      onEvent: (event: AiGenerateEvent) => void;
    }
  >();

  let listenersRegistered = false;
  const ensureListeners = () => {
    if (listenersRegistered) return;
    listenersRegistered = true;

    void plugin.addListener("aicoreStatus", (nativeStatus) => {
      const status = toAiStatus(nativeStatus);
      statusListeners.forEach((cb) => cb(status));
    });

    void plugin.addListener("aicoreEvent", (event: NativeAiCoreEvent) => {
      const entry = activeGenerations.get(event.id);
      if (!entry || entry.aborted) return;

      if (event.type === "text") {
        entry.accumulated += event.text;
        const hitStop = entry.stop.find((seq) => seq && entry.accumulated.endsWith(seq));
        entry.onEvent({ type: "text", text: event.text });
        if (hitStop) {
          entry.aborted = true;
          activeGenerations.delete(event.id);
          void plugin.aicoreAbort({ id: event.id }).catch(() => {});
          entry.onEvent({
            type: "done",
            reason: "stop",
            promptTokens: 0,
            cachedTokens: 0,
            outputTokens: Math.ceil(entry.accumulated.length / 4),
            promptMs: 0,
            generateMs: 0,
          });
        }
        return;
      }

      activeGenerations.delete(event.id);
      if (event.type === "done") {
        entry.onEvent({
          type: "done",
          reason: event.reason,
          promptTokens: event.promptTokens,
          cachedTokens: event.cachedTokens,
          outputTokens: event.outputTokens,
          promptMs: event.promptMs,
          generateMs: event.generateMs,
        });
      } else {
        entry.onEvent({ type: "error", message: event.message });
      }
    });
  };

  return {
    async status(): Promise<AiStatus> {
      ensureListeners();
      try {
        return toAiStatus(await plugin.aicoreStatus());
      } catch (error) {
        return {
          state: "error",
          backend: "aicore",
          modelId: AICORE_MODEL_ID,
          model: AICORE_MODEL_LABEL,
          message:
            error instanceof Error
              ? error.message
              : "Android AICore is unavailable on this device.",
        };
      }
    },

    async load(): Promise<AiStatus> {
      ensureListeners();
      try {
        const result = toAiStatus(await plugin.aicoreLoad());
        statusListeners.forEach((cb) => cb(result));
        return result;
      } catch (error) {
        const failed: AiStatus = {
          state: "error",
          backend: "aicore",
          modelId: AICORE_MODEL_ID,
          model: AICORE_MODEL_LABEL,
          message:
            error instanceof Error
              ? error.message
              : "Could not initialize Gemini Nano via Android AICore.",
        };
        statusListeners.forEach((cb) => cb(failed));
        return failed;
      }
    },

    async chatTemplate(): Promise<string> {
      return "";
    },

    generate(
      request: AiGenerateRequest,
      onEvent: (event: AiGenerateEvent) => void,
    ): () => void {
      ensureListeners();
      const id = crypto.randomUUID();
      const entry = {
        stop: request.stop ?? [],
        accumulated: "",
        aborted: false,
        onEvent,
      };
      activeGenerations.set(id, entry);

      void plugin
        .aicoreGenerate({
          id,
          prompt: request.prompt,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          topK: request.topK,
        })
        .catch((error) => {
          if (entry.aborted) return;
          activeGenerations.delete(id);
          onEvent({
            type: "error",
            message:
              error instanceof Error ? error.message : "AICore generation failed.",
          });
        });

      return () => {
        if (entry.aborted) return;
        entry.aborted = true;
        activeGenerations.delete(id);
        void plugin.aicoreAbort({ id }).catch(() => {});
      };
    },

    onStatus(callback: (status: AiStatus) => void): () => void {
      ensureListeners();
      statusListeners.add(callback);
      return () => void statusListeners.delete(callback);
    },
  };
}

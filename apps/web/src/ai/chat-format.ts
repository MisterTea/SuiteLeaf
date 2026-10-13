// How one model family writes prompts, thinking and tool calls. The stream
// function (model-stream.ts) is the same for every model; it reads the
// model's output through these markers and parsers.
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import { AI_MODELS, type AiModelId, type AiModelInfo } from "@suiteleaf/core/ai";
import {
  THOUGHT,
  THOUGHT_END,
  TOOL_CALL,
  TOOL_CALL_END,
  parseToolCall,
  renderConversation,
  renderSystem,
  trimStops,
  type ParsedCall,
} from "./gemma";
import { frognanoFormat } from "./qwen";

export { frognanoFormat };

export interface ChatFormat {
  info: AiModelInfo;
  /** The markers around one tool call. */
  toolCall: readonly [open: string, close: string];
  /** `marker` starts a thinking block, `open` is the whole opening (marker plus channel name), `close` ends it. */
  thinking: { marker: string; open: string; close: string };
  /** The prompt opens a thinking block, so the reply starts inside it. */
  startsThinking: boolean;
  /** How a reply begins when the model writes a call but leaves out its opening marker. */
  bareCall: string;
  /** The whole prompt. `raw` returns what the model wrote for an earlier reply, when known. */
  render(
    systemPrompt: string,
    tools: Tool[],
    messages: Message[],
    raw: (message: AssistantMessage) => string | undefined,
  ): string;
  /** Parse the text between the tool-call markers. */
  parseCall(body: string, tools: Tool[]): ParsedCall;
  /** The tool a call that is still being written is for, once its name is out. */
  draftName(body: string): string | undefined;
  /** Remove the stop markers the backend leaves at the end of a reply. */
  trimStops(text: string): string;
}

export const gemmaFormat: ChatFormat = {
  info: AI_MODELS["gemma-4-e4b"],
  toolCall: [TOOL_CALL, TOOL_CALL_END],
  thinking: { marker: "<|channel>", open: THOUGHT, close: THOUGHT_END },
  startsThinking: false,
  bareCall: "call:",
  render: (systemPrompt, tools, messages, raw) => renderSystem(systemPrompt, tools) + renderConversation(messages, raw),
  parseCall: (body) => parseToolCall(body),
  draftName: (body) => /^\s*call:([\w.-]+)/.exec(body)?.[1],
  trimStops,
};

export const formatFor = (id: AiModelId | undefined): ChatFormat => (id === "frognano-4b" ? frognanoFormat : gemmaFormat);

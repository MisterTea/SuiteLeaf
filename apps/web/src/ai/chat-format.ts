// How one model family writes prompts, thinking and tool calls. The stream
// function (model-stream.ts) is the same for every model; it reads the
// model's output through these markers and parsers.
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import { AI_MODELS, type AiModelInfo } from "@suiteleaf/core/ai";
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
import { museFormat } from "./muse";
import { frognanoFormat } from "./qwen";

export { frognanoFormat, museFormat };

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
  /** The model also writes calls as just the tool's name and arguments (`todo{…}`), leaving out `bareCall` too. */
  bareName?: boolean;
  /**
   * Drop this many characters from the start of the remaining reply (a channel header).
   * Return -1 when more text might still complete the header.
   */
  leadingSkip?(text: string, final: boolean): number;
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
  bareName: true,
  render: (systemPrompt, tools, messages, raw) => renderSystem(systemPrompt, tools) + renderConversation(messages, raw),
  parseCall: (body) => parseToolCall(body),
  draftName: (body) => /^\s*call:([\w.-]+)/.exec(body)?.[1],
  trimStops,
};

/** Gemma and Muse Glimmer use their own markers. FrogNano is the default, including a model name this app does not ship. */
export const formatFor = (id: string | undefined): ChatFormat =>
  id === "gemma-4-e4b" ? gemmaFormat : id && /muse[-_]?glimmer/i.test(id) ? museFormat : frognanoFormat;

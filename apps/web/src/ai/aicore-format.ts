import type { AssistantMessage, Message, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
import { AI_MODELS } from "@suiteleaf/core/ai";
import type { ChatFormat } from "./chat-format";
import type { ParsedCall } from "./gemma";

export const AICORE_TOOL_CALL = "<tool_call>";
export const AICORE_TOOL_CALL_END = "</tool_call>";

const userText = (message: Message & { role: "user" }) =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((p) => (p.type === "text" ? p.text : "")).join("");

const resultText = (m: ToolResultMessage) =>
  m.content.map((part) => (part.type === "text" ? part.text : "")).join("");

function renderAiCorePrompt(
  systemPrompt: string,
  tools: Tool[],
  messages: Message[],
  raw: (message: AssistantMessage) => string | undefined,
): string {
  const sections: string[] = [];
  sections.push(systemPrompt.trim());

  if (tools.length > 0) {
    const toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    sections.push(
      `Available tools (call by replying with ${AICORE_TOOL_CALL}{"name":"<tool>","arguments":{...}}${AICORE_TOOL_CALL_END}):\n` +
        JSON.stringify(toolDefs),
    );
  }

  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      sections.push(`User: ${userText(message).trim()}`);
    } else if (message.role === "toolResult") {
      sections.push(`Tool result (${message.toolName}): ${resultText(message).trim()}`);
    } else if (message.role === "assistant") {
      const rawText = raw(message);
      if (rawText !== undefined) {
        sections.push(`Assistant: ${rawText.trim()}`);
      } else {
        const parts: string[] = [];
        for (const item of message.content) {
          if (item.type === "text" && item.text.trim()) parts.push(item.text.trim());
          if (item.type === "toolCall") {
            parts.push(
              `${AICORE_TOOL_CALL}${JSON.stringify({ name: item.name, arguments: item.arguments })}${AICORE_TOOL_CALL_END}`,
            );
          }
        }
        if (parts.length) sections.push(`Assistant: ${parts.join("\n")}`);
      }
    }
  }

  sections.push("Assistant:");
  return sections.join("\n\n");
}

function parseAiCoreCall(body: string): ParsedCall {
  const trimmed = body.trim();
  try {
    const parsed = JSON.parse(trimmed) as { name?: unknown; arguments?: unknown };
    if (typeof parsed.name === "string" && parsed.name) {
      const args =
        parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
          ? (parsed.arguments as Record<string, unknown>)
          : {};
      return { name: parsed.name, arguments: args, raw: body };
    }
  } catch {
    // Fall through to error.
  }
  return { name: "", arguments: {}, raw: body, error: "Invalid JSON tool call." };
}

/** Prompt format for Android AICore (ML Kit GenAI Prompt API, ModelPreference.FULL). */
export const aicoreFormat: ChatFormat = {
  info: AI_MODELS["aicore-full"],
  toolCall: [AICORE_TOOL_CALL, AICORE_TOOL_CALL_END],
  thinking: { marker: "", open: "", close: "" },
  startsThinking: false,
  bareCall: '{"name":',
  render: renderAiCorePrompt,
  parseCall: (body) => parseAiCoreCall(body),
  draftName: (body) => /"name"\s*:\s*"([^"]+)"/.exec(body)?.[1],
  trimStops: (text) => text.trimEnd(),
};

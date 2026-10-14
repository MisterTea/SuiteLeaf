// FrogNano (Qwen3.5) prompt rendering and tool-call parsing.
//
// The system turn comes from the model's official chat template. Later turns
// follow the template's layout. Replies to the current request are replayed
// from the model's raw output, thinking included, so each request extends the
// last one token for token. Replies to earlier requests lose their thinking,
// as the template renders them. qwen.test.ts checks this against the template.
import { Template } from "@huggingface/jinja";
import type { AssistantMessage, Message, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
import { AI_MODELS } from "@suiteleaf/core/ai";
import type { ChatFormat } from "./chat-format";
import { templateTools, type ParsedCall } from "./gemma";
import officialTemplate from "./frognano-chat-template.jinja?raw";

export const QWEN_TOOL_CALL = "<tool_call>";
export const QWEN_TOOL_CALL_END = "</tool_call>";
const GENERATION_PROMPT = "<|im_start|>assistant\n<think>\n";

let compiled: Template | undefined;
const template = () => (compiled ??= new Template(officialTemplate));

/** The system turn: instructions and tool declarations. */
export function renderQwenSystem(systemPrompt: string, tools: Tool[]) {
  // The template refuses a conversation without a user turn, so render one and cut it off.
  const text = template().render({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "." },
    ],
    tools: tools.length ? templateTools(tools) : undefined,
    add_generation_prompt: false,
  });
  return text.slice(0, text.lastIndexOf("<|im_start|>user\n"));
}

const userText = (message: Message & { role: "user" }) =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
const resultText = (m: ToolResultMessage) => m.content.map((part) => (part.type === "text" ? part.text : "")).join("");

/** JSON the way the template's `tojson` writes it, with a space after "," and ":". */
function tojson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(tojson).join(", ")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${tojson(v)}`)
      .join(", ")}}`;
  return JSON.stringify(value);
}

/** A parameter value as the template prints it. */
const formatValue = (value: unknown) => (value !== null && typeof value === "object" ? tojson(value) : String(value));

export function formatQwenCall(name: string, args: Record<string, unknown>) {
  let out = `${QWEN_TOOL_CALL}\n<function=${name}>\n`;
  for (const [key, value] of Object.entries(args)) out += `<parameter=${key}>\n${formatValue(value)}\n</parameter>\n`;
  return `${out}</function>\n${QWEN_TOOL_CALL_END}`;
}

export const trimQwenStops = (text: string) => text.replace(/(<\|im_end\|>|<\|endoftext\|>)+\s*$/, "");

/** The turns after the system turn, ending with the opening of the model's reply. */
export function renderQwenConversation(
  messages: Message[],
  raw: (message: AssistantMessage) => string | undefined = () => undefined,
) {
  const lastQuery = messages.map((m) => m.role).lastIndexOf("user");
  let out = "";
  messages.forEach((message, i) => {
    if (message.role === "system") return;
    if (message.role === "user") {
      out += `<|im_start|>user\n${userText(message).trim()}<|im_end|>\n`;
      return;
    }
    if (message.role === "toolResult") {
      if (messages[i - 1]?.role !== "toolResult") out += "<|im_start|>user";
      out += `\n<tool_response>\n${resultText(message).trim()}\n</tool_response>`;
      if (messages[i + 1]?.role !== "toolResult") out += "<|im_end|>\n";
      return;
    }
    const current = i > lastQuery;
    const rawText = raw(message);
    if (current && rawText !== undefined) {
      out += `${GENERATION_PROMPT}${trimQwenStops(rawText)}<|im_end|>\n`;
      return;
    }
    const content = message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim();
    const reasoning = message.content
      .filter((c) => c.type === "thinking")
      .map((c) => c.thinking)
      .join("")
      .trim();
    out += current ? `${GENERATION_PROMPT}${reasoning}\n</think>\n\n${content}` : `<|im_start|>assistant\n${content}`;
    message.content
      .filter((c) => c.type === "toolCall")
      .forEach((call, k) => {
        out += (k > 0 ? "\n" : content ? "\n\n" : "") + formatQwenCall(call.name, call.arguments);
      });
    out += "<|im_end|>\n";
  });
  return out + GENERATION_PROMPT;
}

interface ParamSchema {
  type?: string;
  anyOf?: ParamSchema[];
}

/** A parameter's text as the type its schema asks for. */
function convert(text: string, schema: ParamSchema | undefined): unknown {
  const type = schema?.type ?? schema?.anyOf?.find((s) => s.type)?.type;
  if (type === "string") return text;
  const trimmed = text.trim();
  if (type === "integer" || type === "number") return trimmed !== "" && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : text;
  if (type === "boolean") return /^true$/i.test(trimmed) ? true : /^false$/i.test(trimmed) ? false : text;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Python-style lists ("[['Total', '=SUM(B2:B6)']]") are common; anything else stays text.
    if (type === "array" || type === "object") {
      try {
        return JSON.parse(trimmed.replace(/'/g, '"'));
      } catch {
        return text;
      }
    }
    return text;
  }
}

/** Parse the body of one `<tool_call>…</tool_call>` block. */
export function parseQwenCall(body: string, tools: Tool[]): ParsedCall {
  const raw = body;
  const fn = /<function=([^>\n]+)>/.exec(body);
  if (!fn) {
    // The JSON form older Qwen models use ({"name": …, "arguments": {…}}).
    try {
      const call = JSON.parse(body.trim());
      if (typeof call?.name === "string") return { name: call.name, arguments: call.arguments ?? {}, raw };
    } catch {
      // Not JSON either.
    }
    return { name: "", arguments: {}, error: "The tool call has no <function=name> line.", raw };
  }
  const name = fn[1].trim();
  const properties = (tools.find((t) => t.name === name)?.parameters as { properties?: Record<string, ParamSchema> })?.properties;
  const args: Record<string, unknown> = {};
  const rest = body.slice(fn.index + fn[0].length);
  for (const m of rest.matchAll(/<parameter=([^>\n]+)>\n?([\s\S]*?)\n?<\/parameter>/g))
    args[m[1].trim()] = convert(m[2], properties?.[m[1].trim()]);
  const opened = (rest.match(/<parameter=/g) ?? []).length;
  if (opened > Object.keys(args).length) {
    const unclosed = [...rest.matchAll(/<parameter=([^>\n]+)>/g)].map((m) => m[1].trim()).find((k) => !(k in args));
    return { name, arguments: {}, error: `The parameter "${unclosed}" has no </parameter>.`, raw };
  }
  return { name, arguments: args, raw };
}

export const frognanoFormat: ChatFormat = {
  info: AI_MODELS["frognano-4b"],
  toolCall: [QWEN_TOOL_CALL, QWEN_TOOL_CALL_END],
  thinking: { marker: "<think>", open: "<think>", close: "</think>" },
  startsThinking: true,
  bareCall: "<function=",
  render: (systemPrompt, tools, messages, raw) => renderQwenSystem(systemPrompt, tools) + renderQwenConversation(messages, raw),
  parseCall: parseQwenCall,
  draftName: (body) => /<function=([\w.-]+)>/.exec(body)?.[1],
  trimStops: trimQwenStops,
};

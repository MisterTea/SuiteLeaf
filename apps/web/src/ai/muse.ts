// Muse Glimmer prompt rendering and ATEM tool-call parsing.
//
// The system turn comes from the model's official chat template. Later turns
// follow that template. Replies in the current request are replayed from the
// model's raw output, so each request extends the last one. <|eom|> ends a
// channel and the turn continues; only <|eot|> and <|end_of_text|> end the reply.
import { Template } from "@huggingface/jinja";
import type { AssistantMessage, Message, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
import { AI_MODELS } from "@suiteleaf/core/ai";
import type { ChatFormat } from "./chat-format";
import { templateTools, type ParsedCall } from "./gemma";
import officialTemplate from "./muse-glimmer-chat-template.jinja?raw";

export const ATEM_CALL = "<atem:function_calls>";
export const ATEM_CALL_END = "</atem:function_calls>";
const BOS = "<|begin_of_text|>";
const GENERATION_PROMPT = "<|start|>assistant";
const MESSAGE = "<|message|>";

let compiled: Template | undefined;
const template = () => (compiled ??= new Template(officialTemplate));

/** The system turn: instructions, tool declarations, and the recipient list. */
export function renderMuseSystem(systemPrompt: string, tools: Tool[]) {
  const text = template().render({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "." },
    ],
    tools: tools.length ? templateTools(tools) : undefined,
    add_generation_prompt: false,
    bos_token: BOS,
  });
  return text.slice(0, text.lastIndexOf("<|start|>user<|message|>"));
}

const userText = (message: Message & { role: "user" }) =>
  typeof message.content === "string" ? message.content : message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
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

/** A parameter value as the template prints it. Strings are copied as-is. */
function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (typeof value === "object") return tojson(value);
  return String(value);
}

export function formatAtem(name: string, args: Record<string, unknown>) {
  let out = `${ATEM_CALL}\n<atem:invoke name="${name}">\n`;
  for (const [key, value] of Object.entries(args)) out += `<atem:parameter name="${key}">${formatValue(value)}</atem:parameter>\n`;
  return `${out}</atem:invoke>\n${ATEM_CALL_END}`;
}

export const trimMuseStops = (text: string) => text.replace(/(?:<\|eot\|>|<\|end_of_text\|>)+\s*$/, "");

/** The turns after the system turn, ending where the model's reply begins. */
export function renderMuseConversation(
  messages: Message[],
  raw: (message: AssistantMessage) => string | undefined = () => undefined,
) {
  const lastQuery = messages.map((m) => m.role).lastIndexOf("user");
  let out = "";
  messages.forEach((message, i) => {
    if (message.role === "system") return;
    const end = i + 1 < messages.length && messages[i + 1].role === message.role ? "<|eom|>" : "<|eot|>";
    if (message.role === "user") {
      out += `<|start|>user<|message|>${userText(message)}<|eot|>`;
      return;
    }
    if (message.role === "toolResult") {
      out += `<|start|>tool ${message.toolName}<|message|><tool_output name="${message.toolName}">\n${resultText(message)}\n</tool_output><|eot|>`;
      return;
    }
    const current = i > lastQuery;
    const rawText = raw(message);
    if (current && rawText !== undefined) {
      out += `${GENERATION_PROMPT}${trimMuseStops(rawText)}${end}`;
      return;
    }
    const reasoning = message.content
      .filter((c) => c.type === "thinking")
      .map((c) => c.thinking)
      .join("");
    const calls = message.content.filter((c) => c.type === "toolCall");
    if (reasoning) out += `<|start|>assistant to=self<|message|>${reasoning}<|eom|>`;
    if (calls.length) {
      calls.forEach((call, k) => {
        out += `<|start|>assistant to=${call.name}<|message|>${formatAtem(call.name, call.arguments)}${k === calls.length - 1 ? end : "<|eom|>"}`;
      });
      return;
    }
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    out += `<|start|>assistant to=user<|message|>${text}${end}`;
  });
  return out + GENERATION_PROMPT;
}

/**
 * Characters of a channel header to drop before they are shown.
 * Returns -1 while the header may still be incomplete.
 * `to=self` is left for the thinking marker. `<|eom|>` only separates channels.
 */
export function skipMuseChannel(text: string, final: boolean): number {
  if (text.startsWith("<|eom|>")) return "<|eom|>".length;
  if (text.startsWith("to=self<|message|>")) return 0;
  if (text.startsWith(" to=self<|message|>")) return 1;
  if (text.startsWith("<|start|>assistant to=self<|message|>")) return "<|start|>assistant ".length;
  const header =
    /^(?:<\|start\|>assistant)? to=(?!self<\|message\|>)[A-Za-z_][\w.*-]*<\|message\|>/.exec(text) ??
    /^to=(?!self<\|message\|>)[A-Za-z_][\w.*-]*<\|message\|>/.exec(text);
  if (header) return header[0].length;
  if (final) return 0;
  if (text.startsWith("<") && "<|eom|>".startsWith(text)) return -1;
  if ("<|start|>assistant ".startsWith(text)) return -1;
  if (text.startsWith("<|start|>assistant to=") && !text.includes(MESSAGE)) return -1;
  if ((text === " " || text.startsWith(" to=") || /^to=[A-Za-z_][\w.*-]*$/.test(text)) && !text.includes(MESSAGE)) return -1;
  return 0;
}

interface ParamSchema {
  type?: string;
  anyOf?: ParamSchema[];
}

/** A parameter's text as the type its schema asks for. String values keep their spaces. */
function convert(text: string, schema: ParamSchema | undefined): unknown {
  const type = schema?.type ?? schema?.anyOf?.find((s) => s.type)?.type;
  if (type === "string") return text;
  const trimmed = text.trim();
  if (type === "integer" || type === "number") return trimmed !== "" && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : text;
  if (type === "boolean") return /^true$/i.test(trimmed) ? true : /^false$/i.test(trimmed) ? false : text;
  try {
    return JSON.parse(trimmed);
  } catch {
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

/** Parse the body of one `<atem:function_calls>…</atem:function_calls>` block. */
export function parseMuseCall(body: string, tools: Tool[]): ParsedCall {
  const raw = body;
  const fn = /<atem:invoke name="([^"]+)"/.exec(body);
  if (!fn) return { name: "", arguments: {}, error: 'The tool call has no <atem:invoke name="…">.', raw };
  const name = fn[1];
  const properties = (tools.find((t) => t.name === name)?.parameters as { properties?: Record<string, ParamSchema> })?.properties;
  const args: Record<string, unknown> = {};
  const rest = body.slice(fn.index);
  for (const m of rest.matchAll(/<atem:parameter name="([^"]+)">([\s\S]*?)<\/atem:parameter>/g))
    args[m[1]] = convert(m[2], properties?.[m[1]]);
  const opened = (rest.match(/<atem:parameter name="/g) ?? []).length;
  if (opened > Object.keys(args).length) {
    const unclosed = [...rest.matchAll(/<atem:parameter name="([^"]+)"/g)].map((m) => m[1]).find((k) => !(k in args));
    return { name, arguments: {}, error: `The parameter "${unclosed}" has no </atem:parameter>.`, raw };
  }
  return { name, arguments: args, raw };
}

export const museFormat: ChatFormat = {
  info: AI_MODELS["muse-glimmer-30b"],
  toolCall: [ATEM_CALL, ATEM_CALL_END],
  thinking: { marker: "to=self<|message|>", open: "to=self<|message|>", close: "<|eom|>" },
  startsThinking: false,
  bareCall: "<atem:invoke",
  leadingSkip: skipMuseChannel,
  render: (systemPrompt, tools, messages, raw) => renderMuseSystem(systemPrompt, tools) + renderMuseConversation(messages, raw),
  parseCall: parseMuseCall,
  draftName: (body) => /<atem:invoke name="([\w.-]+)"/.exec(body)?.[1],
  trimStops: trimMuseStops,
};

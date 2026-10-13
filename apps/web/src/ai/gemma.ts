// Gemma 4 prompt rendering and output parsing.
//
// The system turn (instructions and tool declarations) is rendered with the
// model's official chat template. Conversation turns follow the same template
// layout, but earlier model turns are replayed from the model's own raw output
// so every request extends the previous one token for token and the backend
// can reuse its KV cache. gemma.test.ts checks the result against the official
// template.
import { Template } from "@huggingface/jinja";
import type { AssistantMessage, Message, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
import officialTemplate from "./gemma4-chat-template.jinja?raw";

export const Q = '<|"|>';
export const TOOL_CALL = "<|tool_call>";
export const TOOL_CALL_END = "<tool_call|>";
export const TOOL_RESPONSE = "<|tool_response>";
export const TOOL_RESPONSE_END = "<tool_response|>";
export const TURN_END = "<turn|>";
export const THOUGHT = "<|channel>thought\n";
export const THOUGHT_END = "<channel|>";

let compiled: Template | undefined;
const template = () => (compiled ??= new Template(officialTemplate));

/** Tool declarations in the shape the chat template expects. */
export function templateTools(tools: Tool[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      // Drops TypeBox's symbol keys and anything the template can't print.
      parameters: JSON.parse(JSON.stringify(tool.parameters)),
    },
  }));
}

export function renderSystem(systemPrompt: string, tools: Tool[], thinking = false) {
  return template().render({
    messages: [{ role: "system", content: systemPrompt }],
    tools: tools.length ? templateTools(tools) : undefined,
    bos_token: "<bos>",
    add_generation_prompt: false,
    enable_thinking: thinking,
  });
}

/** Gemma's argument syntax: unquoted keys, strings wrapped in <|"|>. */
export function formatArgument(value: unknown): string {
  if (typeof value === "string") return Q + value + Q;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return "[" + value.map(formatArgument).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      dictsort(value as Record<string, unknown>)
        .map(([k, v]) => `${k}:${formatArgument(v)}`)
        .join(",") +
      "}"
    );
  return String(value);
}

/** Jinja's dictsort: case-insensitive key order. */
function dictsort(value: Record<string, unknown>) {
  return Object.entries(value).sort(([a], [b]) => {
    const x = a.toLowerCase(),
      y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export const formatToolCall = (name: string, args: Record<string, unknown>) =>
  `${TOOL_CALL}call:${name}{${dictsort(args)
    .map(([k, v]) => `${k}:${formatArgument(v)}`)
    .join(",")}}${TOOL_CALL_END}`;

const resultText = (m: ToolResultMessage) =>
  m.content.map((part) => (part.type === "text" ? part.text : "")).join("");

export const formatToolResponse = (name: string, text: string) =>
  `${TOOL_RESPONSE}response:${name}{value:${Q}${text}${Q}}${TOOL_RESPONSE_END}`;

const userText = (content: Message & { role: "user" }) =>
  typeof content.content === "string"
    ? content.content
    : content.content.map((p) => (p.type === "text" ? p.text : "")).join("");

/** Remove thinking channels, as the template does for replayed model text. */
function stripThinking(text: string) {
  return text
    .split(THOUGHT_END)
    .map((part) => (part.includes("<|channel>") ? part.split("<|channel>")[0] : part))
    .join("")
    .trim();
}

/**
 * Render the conversation after the system turn. `raw` returns the exact text
 * the model generated for an assistant message, when known.
 */
export function renderConversation(
  messages: Message[],
  raw: (message: AssistantMessage) => string | undefined = () => undefined,
) {
  let out = "";
  let prevType: "tool_call" | "tool_response" | null = null;
  let prevRole: string | null = null;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "toolResult" || message.role === "system") continue;
    prevType = null;
    const role = message.role === "assistant" ? "model" : "user";
    if (!(role === "model" && prevRole === "assistant")) out += `<|turn>${role}\n`;
    prevRole = message.role;
    if (message.role === "user") {
      out += userText(message).trim() + `${TURN_END}\n`;
      continue;
    }
    const responses: ToolResultMessage[] = [];
    for (let k = i + 1; k < messages.length && messages[k].role === "toolResult"; k++)
      responses.push(messages[k] as ToolResultMessage);
    const calls = message.content.filter((c) => c.type === "toolCall");
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    const rawText = raw(message);
    const responseBlocks = responses
      .map((r) => {
        const call = calls.find((c) => c.id === r.toolCallId);
        return formatToolResponse(call?.name ?? r.toolName, resultText(r));
      })
      .join("");
    if (rawText !== undefined) {
      // The final sampled token (whichever stop token it was) never entered
      // the KV cache, so it can be normalized to what the template expects.
      out += trimStops(rawText);
      if (calls.length) {
        out += responses.length ? responseBlocks : TOOL_RESPONSE;
        prevType = responses.length ? "tool_response" : "tool_call";
      } else out += `${TURN_END}\n`;
      continue;
    }
    if (calls.length) {
      out += calls.map((c) => formatToolCall(c.name, c.arguments)).join("");
      prevType = "tool_call";
    }
    if (responses.length) {
      out += responseBlocks;
      prevType = "tool_response";
    }
    const content = stripThinking(text);
    out += content;
    if (prevType === "tool_call") out += TOOL_RESPONSE;
    else if (!(prevType === "tool_response" && !content)) out += `${TURN_END}\n`;
  }
  if (prevType !== "tool_response" && prevType !== "tool_call") out += "<|turn>model\n";
  return out;
}

export interface ParsedCall {
  name: string;
  arguments: Record<string, unknown>;
  error?: string;
  raw: string;
}

/** Parse one Gemma argument value starting at `i`. */
export function parseValue(src: string, i: number): [unknown, number] {
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  ws();
  if (src.startsWith(Q, i)) {
    const end = src.indexOf(Q, i + Q.length);
    if (end < 0) throw new Error("Unterminated string.");
    return [src.slice(i + Q.length, end), end + Q.length];
  }
  const c = src[i];
  if (c === '"') {
    let j = i + 1;
    while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
    return [JSON.parse(src.slice(i, j + 1)), j + 1];
  }
  if (c === "{") {
    const obj: Record<string, unknown> = {};
    i++;
    ws();
    if (src[i] === "}") return [obj, i + 1];
    for (;;) {
      ws();
      let key: string;
      if (src.startsWith(Q, i) || src[i] === '"') {
        const [k, next] = parseValue(src, i);
        key = String(k);
        i = next;
      } else {
        const m = /^[^:{}\[\],\s]+/.exec(src.slice(i));
        if (!m) throw new Error(`Expected a key at ${i}.`);
        key = m[0];
        i += key.length;
      }
      ws();
      if (src[i] !== ":") throw new Error(`Expected ":" after ${key}.`);
      const [v, next] = parseValue(src, i + 1);
      obj[key] = v;
      i = next;
      ws();
      if (src[i] === ",") {
        i++;
        continue;
      }
      if (src[i] === "}") return [obj, i + 1];
      throw new Error(`Expected "," or "}" at ${i}.`);
    }
  }
  if (c === "[") {
    const arr: unknown[] = [];
    i++;
    ws();
    if (src[i] === "]") return [arr, i + 1];
    for (;;) {
      const [v, next] = parseValue(src, i);
      arr.push(v);
      i = next;
      ws();
      if (src[i] === ",") {
        i++;
        continue;
      }
      if (src[i] === "]") return [arr, i + 1];
      throw new Error(`Expected "," or "]" at ${i}.`);
    }
  }
  const m = /^[^,}\]]+/.exec(src.slice(i));
  if (!m) throw new Error(`Expected a value at ${i}.`);
  const word = m[0].trim();
  i += m[0].length;
  if (word === "true") return [true, i];
  if (word === "false") return [false, i];
  if (word === "null" || word === "None") return [null, i];
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(word)) return [Number(word), i];
  return [word, i];
}

/** Parse the body of one `<|tool_call>…<tool_call|>` block. */
export function parseToolCall(body: string): ParsedCall {
  const raw = body;
  const m = /^\s*call:([\w.-]+)\s*/.exec(body);
  if (!m) return { name: "", arguments: {}, error: "The tool call has no name.", raw };
  const name = m[1];
  const rest = body.slice(m[0].length);
  if (!rest.trim()) return { name, arguments: {}, raw };
  const parse = (src: string) => {
    const [value, end] = parseValue(src, 0);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Arguments must be an object.");
    if (src.slice(end).trim()) throw new Error("Unexpected text after the arguments.");
    return value as Record<string, unknown>;
  };
  try {
    return { name, arguments: parse(rest), raw };
  } catch (error) {
    // Small models sometimes open a list of lists with one "[" too many ("[[[a, b], [c, d]]").
    const surplus = bracketSurplus(rest);
    if (surplus > 0) {
      try {
        const repaired = rest.replace(new RegExp(`\\[{${surplus + 2},}`), (run) => run.slice(surplus));
        if (repaired !== rest) return { name, arguments: parse(repaired), raw };
      } catch {
        // Fall through to the original error.
      }
    }
    const brackets = surplus
      ? ` The brackets do not match: there are ${Math.abs(surplus)} more "${surplus > 0 ? "[" : "]"}" than "${surplus > 0 ? "]" : "["}".`
      : "";
    return { name, arguments: {}, error: (error as Error).message + brackets, raw };
  }
}

/** How many more "[" than "]" there are outside strings. */
function bracketSurplus(src: string) {
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    if (src.startsWith(Q, i)) {
      const end = src.indexOf(Q, i + Q.length);
      if (end < 0) break;
      i = end + Q.length - 1;
    } else if (src[i] === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      i = j;
    } else if (src[i] === "[") n++;
    else if (src[i] === "]") n--;
  }
  return n;
}

/** Remove trailing stop markers the backend leaves on the output. */
export const trimStops = (text: string) =>
  text.replace(/(<turn\|>|<\|tool_response>|<eos>)+\s*$/, "");

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Template } from "@huggingface/jinja";
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import {
  formatToolCall,
  parseToolCall,
  parseValue,
  renderConversation,
  renderSystem,
  templateTools,
} from "../apps/web/src/ai/gemma";
import { createGemmaStreamFn, gemmaModel } from "../apps/web/src/ai/gemma-stream";

const official = new Template(
  readFileSync(new URL("../apps/web/src/ai/gemma4-chat-template.jinja", import.meta.url), "utf8"),
);

const tools: Tool[] = [
  {
    name: "set_values",
    description: "Write values into cells.",
    parameters: {
      type: "object",
      properties: {
        range: { type: "string", description: "A1 range" },
        values: { type: "array", items: { type: "array", items: { type: "string" } } },
        overwrite: { type: "boolean" },
      },
      required: ["range", "values"],
    } as never,
  },
  {
    name: "insert_chart",
    description: "Insert a chart.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["column", "line"] },
        title: { type: "string" },
      },
      required: ["type"],
    } as never,
  },
];

const assistant = (content: AssistantMessage["content"]): AssistantMessage => ({
  role: "assistant",
  content,
  api: "suiteleaf-local",
  provider: "suiteleaf",
  model: "gemma",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: 0,
});

const conversation: Message[] = [
  { role: "user", content: "  Chart the budget.  ", timestamp: 0 },
  assistant([
    { type: "toolCall", id: "a", name: "set_values", arguments: { values: [["1", "2"]], range: "B2:C2", overwrite: true } },
  ]),
  { role: "toolResult", toolCallId: "a", toolName: "set_values", content: [{ type: "text", text: "Wrote 2 cells." }], isError: false, timestamp: 0 },
  assistant([{ type: "toolCall", id: "b", name: "insert_chart", arguments: { type: "column", title: "Costs" } }]),
  { role: "toolResult", toolCallId: "b", toolName: "insert_chart", content: [{ type: "text", text: "Inserted." }], isError: false, timestamp: 0 },
  assistant([{ type: "text", text: "Done: the chart is beside the table." }]),
  { role: "user", content: "Thanks", timestamp: 0 },
];

/** The same conversation in the chat template's OpenAI-style message format. */
function toTemplateMessages(messages: Message[]) {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "toolResult")
      return { role: "tool", tool_call_id: m.toolCallId, name: m.toolName, content: m.content };
    if (m.role === "assistant") {
      const calls = m.content.filter((c) => c.type === "toolCall");
      const text = m.content.filter((c) => c.type === "text").map((c) => c.text).join("");
      return {
        role: "assistant",
        content: text,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      };
    }
    return m;
  });
}

describe("Gemma 4 prompt rendering", () => {
  it("matches the official chat template", () => {
    const system = "You help inside SuiteLeaf.";
    const expected = official.render({
      messages: [{ role: "system", content: system }, ...toTemplateMessages(conversation)],
      tools: templateTools(tools),
      bos_token: "<bos>",
      add_generation_prompt: true,
    });
    expect(renderSystem(system, tools) + renderConversation(conversation)).toBe(expected);
  });

  it("matches the template while a tool call is pending", () => {
    const pending = conversation.slice(0, 2);
    const expected = official.render({
      messages: [{ role: "system", content: "S" }, ...toTemplateMessages(pending)],
      tools: templateTools(tools),
      bos_token: "<bos>",
      add_generation_prompt: true,
    });
    expect(renderSystem("S", tools) + renderConversation(pending)).toBe(expected);
  });

  it("replays the model's raw output so the prompt only grows", () => {
    const first = assistant([{ type: "toolCall", id: "a", name: "insert_chart", arguments: { title: "Costs", type: "column" } }]);
    first.responseId = "r1";
    // The model wrote the keys in its own order and ended with <eos>.
    const raw = '<|tool_call>call:insert_chart{type:<|"|>column<|"|>,title:<|"|>Costs<|"|>}<tool_call|><eos>';
    const before = renderConversation([conversation[0]]);
    const after = renderConversation(
      [
        conversation[0],
        first,
        { role: "toolResult", toolCallId: "a", toolName: "insert_chart", content: [{ type: "text", text: "Inserted." }], isError: false, timestamp: 0 },
      ],
      (m) => (m.responseId === "r1" ? raw : undefined),
    );
    expect(after.startsWith(before + raw.replace("<eos>", ""))).toBe(true);
    expect(after.endsWith('<|tool_response>response:insert_chart{value:<|"|>Inserted.<|"|>}<tool_response|>')).toBe(true);
  });
});

describe("Gemma 4 tool-call parsing", () => {
  it("round-trips the template's own formatting", () => {
    const args = { range: "A1:C5", values: [["Team", "Cost"], ["Design", "4,200"]], header: true, n: -2.5 };
    const block = formatToolCall("set_values", args);
    const body = block.slice("<|tool_call>".length, -"<tool_call|>".length);
    expect(parseToolCall(body)).toMatchObject({ name: "set_values", arguments: args });
  });

  it("accepts JSON-style strings, nested objects and bare words", () => {
    expect(parseValue('{"a": "x", b: {c: [1, 2]}, d: column, e: null}', 0)[0]).toEqual({
      a: "x",
      b: { c: [1, 2] },
      d: "column",
      e: null,
    });
  });

  it("reads Python-style 'quoted' words as strings", () => {
    expect(parseValue("[[<|\"|>Rent<|\"|>, 1400], ['Fun, money', 150], [Maya's, 'x']]", 0)[0]).toEqual([
      ["Rent", 1400],
      ["Fun, money", 150],
      ["Maya's", "x"],
    ]);
  });

  it("keeps commas and braces inside strings", () => {
    const parsed = parseToolCall('call:type_text{text:<|"|>Hello, {world}<|"|>}');
    expect(parsed.arguments).toEqual({ text: "Hello, {world}" });
  });

  it("reports malformed calls instead of guessing", () => {
    expect(parseToolCall('call:insert_chart{range:<|"|>A1').error).toBeTruthy();
    expect(parseToolCall("insert_chart{}").error).toBeTruthy();
  });

  it("drops one '[' too many at the start of a list of rows", () => {
    const parsed = parseToolCall(
      'call:insert_table{cells:[[[<|"|>Name<|"|>,<|"|>Bringing<|"|>],[<|"|>Asha [A]<|"|>,<|"|>Beans<|"|>]],header_row:true}',
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.arguments).toEqual({ cells: [["Name", "Bringing"], ["Asha [A]", "Beans"]], header_row: true });
    expect(parseToolCall('call:set_cells{start:<|"|>A8<|"|>,values:[[<|"|>Left<|"|>,<|"|>=B7-C7<|"|>]}').arguments).toEqual({
      start: "A8",
      values: [["Left", "=B7-C7"]],
    });
    expect(parseToolCall('call:insert_table{cells:[[<|"|>a<|"|>],[<|"|>b<|"|>],header_row:true}').error).toMatch(
      /brackets do not match: there are 1 more "\[" than "\]"/,
    );
  });

  it("drops a stray closing brace after the arguments", () => {
    const parsed = parseToolCall('call:set_cells{start:<|"|>A7<|"|>,values:[[<|"|>Total<|"|>, "=SUM(B2:B6)"]]}}');
    expect(parsed.error).toBeUndefined();
    expect(parsed.arguments).toEqual({ start: "A7", values: [["Total", "=SUM(B2:B6)"]] });
    expect(parseToolCall('call:set_cells{start:<|"|>A7<|"|>} start').error).toMatch(/Unexpected text/);
  });
});

describe("Gemma 4 stream", () => {
  /** Run the stream function on a model that writes `chunks`, and return the message. */
  async function streamed(chunks: string[]) {
    const model = {
      generate: (_request: unknown, onEvent: (e: unknown) => void) => {
        setTimeout(() => {
          for (const text of chunks) onEvent({ type: "text", text });
          onEvent({ type: "done", reason: "stop", promptTokens: 1, cachedTokens: 0, outputTokens: 1, promptMs: 1, generateMs: 1 });
        });
        return () => {};
      },
    };
    const stream = createGemmaStreamFn(model as never)(gemmaModel("test"), { systemPrompt: "S", messages: [conversation[0]], tools }, {});
    return (await stream).result();
  }

  it("reads a call whose opening <|tool_call> is missing", async () => {
    const message = await streamed(["ca", "ll:insert_chart{type:", "column}<tool_call|>"]);
    expect(message.content).toEqual([expect.objectContaining({ type: "toolCall", name: "insert_chart", arguments: { type: "column" } })]);
    expect(message.stopReason).toBe("toolUse");
  });

  it("keeps ordinary replies as text", async () => {
    const message = await streamed(["Ca", "lled the club. Done."]);
    expect(message.content).toEqual([{ type: "text", text: "Called the club. Done." }]);
  });
});

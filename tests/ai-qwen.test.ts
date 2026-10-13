import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Template } from "@huggingface/jinja";
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import { templateTools } from "../apps/web/src/ai/gemma";
import { frognanoFormat } from "../apps/web/src/ai/chat-format";
import { createLocalStreamFn, localModelDescriptor } from "../apps/web/src/ai/model-stream";
import { parseQwenCall, renderQwenConversation, renderQwenSystem } from "../apps/web/src/ai/qwen";

const official = new Template(
  readFileSync(new URL("../apps/web/src/ai/frognano-chat-template.jinja", import.meta.url), "utf8"),
);

const tools: Tool[] = [
  {
    name: "set_cells",
    description: "Type into cells.",
    parameters: {
      type: "object",
      properties: {
        start: { type: "string" },
        values: { type: "array", items: { type: "array", items: { type: "string" } } },
      },
      required: ["start", "values"],
    } as never,
  },
  {
    name: "insert_chart",
    description: "Insert a chart.",
    parameters: {
      type: "object",
      properties: { range: { type: "string" }, width: { type: "number" }, legend: { type: "boolean" } },
      required: ["range"],
    } as never,
  },
];

const assistant = (content: AssistantMessage["content"]): AssistantMessage => ({
  role: "assistant",
  content,
  api: "suiteleaf-local",
  provider: "suiteleaf",
  model: "frognano",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: 0,
});

const conversation: Message[] = [
  { role: "user", content: "Chart the budget.", timestamp: 0 },
  assistant([
    { type: "thinking", thinking: "The table is A1:C5." },
    { type: "text", text: "I'll chart it." },
    { type: "toolCall", id: "a", name: "insert_chart", arguments: { range: "A1:C5", width: 400 } },
  ]),
  { role: "toolResult", toolCallId: "a", toolName: "insert_chart", content: [{ type: "text", text: "Inserted." }], isError: false, timestamp: 0 },
  assistant([{ type: "text", text: "Done." }]),
  { role: "user", content: "Add a total row.", timestamp: 0 },
  assistant([
    { type: "thinking", thinking: "Row 6." },
    { type: "toolCall", id: "b", name: "set_cells", arguments: { start: "A6", values: [["Total", "=SUM(B2:B5)"]] } },
    { type: "toolCall", id: "c", name: "insert_chart", arguments: { range: "A1:C6" } },
  ]),
  { role: "toolResult", toolCallId: "b", toolName: "set_cells", content: [{ type: "text", text: "Wrote A6:B6." }], isError: false, timestamp: 0 },
  { role: "toolResult", toolCallId: "c", toolName: "insert_chart", content: [{ type: "text", text: "Inserted." }], isError: false, timestamp: 0 },
];

/** The conversation in the template's OpenAI-style message format. */
function toTemplateMessages(messages: Message[]) {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "toolResult") return { role: "tool", tool_call_id: m.toolCallId, content: m.content.map((c) => (c.type === "text" ? c.text : "")).join("") };
    if (m.role === "assistant") {
      const calls = m.content.filter((c) => c.type === "toolCall");
      return {
        role: "assistant",
        content: m.content.filter((c) => c.type === "text").map((c) => c.text).join(""),
        reasoning_content: m.content.filter((c) => c.type === "thinking").map((c) => c.thinking).join(""),
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) } : {}),
      };
    }
    return m;
  });
}

describe("FrogNano (Qwen3.5) prompt rendering", () => {
  it("matches the official chat template, thinking only kept for the current request", () => {
    const system = "You help inside SuiteLeaf.";
    const expected = official.render({
      messages: [{ role: "system", content: system }, ...toTemplateMessages(conversation)],
      tools: templateTools(tools),
      add_generation_prompt: true,
    });
    expect(renderQwenSystem(system, tools) + renderQwenConversation(conversation)).toBe(expected);
  });

  it("replays the model's raw output for the current request", () => {
    const raw = "Row 6.\n</think>\n\n<tool_call>\n<function=set_cells>\n<parameter=start>\nA6\n</parameter>\n</function>\n</tool_call><|im_end|>";
    const rendered = renderQwenConversation(conversation.slice(0, 7), (m) => (m === conversation[5] ? raw : undefined));
    expect(rendered).toContain(`<|im_start|>assistant\n<think>\n${raw.replace("<|im_end|>", "")}<|im_end|>\n<|im_start|>user\n<tool_response>\nWrote A6:B6.\n</tool_response><|im_end|>\n`);
    expect(rendered.endsWith("<|im_start|>assistant\n<think>\n")).toBe(true);
  });
});

describe("FrogNano tool calls", () => {
  it("converts parameters to the types their schema asks for", () => {
    const parsed = parseQwenCall(
      "\n<function=insert_chart>\n<parameter=range>\nA1:C5\n</parameter>\n<parameter=width>\n400\n</parameter>\n<parameter=legend>\nfalse\n</parameter>\n</function>\n",
      tools,
    );
    expect(parsed).toMatchObject({ name: "insert_chart", arguments: { range: "A1:C5", width: 400, legend: false } });
    expect(parseQwenCall("<function=set_cells>\n<parameter=start>\n007\n</parameter>\n<parameter=values>\n[['Total', '=SUM(B2:B6)']]\n</parameter>\n</function>", tools).arguments).toEqual({
      start: "007",
      values: [["Total", "=SUM(B2:B6)"]],
    });
  });

  it("reports a parameter that was never closed", () => {
    expect(parseQwenCall("<function=set_cells>\n<parameter=start>\nA1", tools).error).toMatch(/"start" has no <\/parameter>/);
  });

  it("streams thinking, text and calls into pi events", async () => {
    const model = {
      generate: (_request: unknown, onEvent: (e: unknown) => void) => {
        setTimeout(() => {
          for (const text of ["The table", " is A1:C5.\n</thi", "nk>\n\nCharting.\n\n<tool_", "call>\n<function=insert_chart>\n<parameter=range>\nA1:C5\n</parameter>\n</function>\n</tool_call>", "<|im_end|>"])
            onEvent({ type: "text", text });
          onEvent({ type: "done", reason: "stop", promptTokens: 1, cachedTokens: 0, outputTokens: 1, promptMs: 1, generateMs: 1 });
        });
        return () => {};
      },
    };
    const stream = createLocalStreamFn(model as never, { format: frognanoFormat })(
      localModelDescriptor(frognanoFormat.info, "test"),
      { systemPrompt: "S", messages: [conversation[0]], tools },
      {},
    );
    const message = await (await stream).result();
    expect(message.content).toEqual([
      { type: "thinking", thinking: "The table is A1:C5.\n" },
      { type: "text", text: "Charting.\n\n" },
      expect.objectContaining({ type: "toolCall", name: "insert_chart", arguments: { range: "A1:C5" } }),
    ]);
    expect(message.stopReason).toBe("toolUse");
  });
});

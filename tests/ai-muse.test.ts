import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Template } from "@huggingface/jinja";
import type { AssistantMessage, Message, Tool } from "@earendil-works/pi-ai";
import { AI_MODELS, modelIdForFile } from "@suiteleaf/core/ai";
import { templateTools } from "../apps/web/src/ai/gemma";
import { formatFor } from "../apps/web/src/ai/chat-format";
import { createLocalStreamFn, localModelDescriptor } from "../apps/web/src/ai/model-stream";
import { parseMuseCall, renderMuseConversation, renderMuseSystem, skipMuseChannel } from "../apps/web/src/ai/muse";

const official = new Template(readFileSync(new URL("../apps/web/src/ai/muse-glimmer-chat-template.jinja", import.meta.url), "utf8"));

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
  model: "muse-glimmer-30b",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: 0,
});

const conversation: Message[] = [
  { role: "user", content: "Chart the budget.", timestamp: 0 },
  assistant([
    { type: "thinking", thinking: "The table is A1:C5." },
    { type: "text", text: "I'll chart it." },
    { type: "toolCall", id: "a", name: "insert_chart", arguments: { range: "A1:C5", width: 400, legend: false } },
  ]),
  { role: "toolResult", toolCallId: "a", toolName: "insert_chart", content: [{ type: "text", text: "Inserted." }], isError: false, timestamp: 0 },
  assistant([{ type: "text", text: "Done." }]),
  { role: "user", content: "Add a total row.", timestamp: 0 },
  assistant([
    { type: "thinking", thinking: "Row 6." },
    { type: "toolCall", id: "b", name: "set_cells", arguments: { start: "A6", values: [["Total", "=SUM(B2:B5)"]] } },
  ]),
  { role: "toolResult", toolCallId: "b", toolName: "set_cells", content: [{ type: "text", text: "Wrote A6:B6." }], isError: false, timestamp: 0 },
];

function toTemplateMessages(messages: Message[]) {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "toolResult")
      return {
        role: "tool",
        name: m.toolName,
        tool_call_id: m.toolCallId,
        content: m.content.map((c) => (c.type === "text" ? c.text : "")).join(""),
      };
    if (m.role === "assistant") {
      const calls = m.content.filter((c) => c.type === "toolCall");
      const reasoning = m.content
        .filter((c) => c.type === "thinking")
        .map((c) => c.thinking)
        .join("");
      return {
        role: "assistant",
        content: m.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join(""),
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      };
    }
    return m;
  });
}

describe("Muse Glimmer prompt rendering", () => {
  it("matches the official chat template", () => {
    const system = "You help inside SuiteLeaf.";
    const expected = official.render({
      messages: [{ role: "system", content: system }, ...toTemplateMessages(conversation)],
      tools: templateTools(tools),
      add_generation_prompt: true,
      bos_token: "<|begin_of_text|>",
    });
    expect(renderMuseSystem(system, tools) + renderMuseConversation(conversation)).toBe(expected);
  });

  it("replays the model's raw output for the current request", () => {
    const raw = ' to=self<|message|>Row 6.<|eom|><|start|>assistant to=set_cells<|message|><atem:function_calls>\n<atem:invoke name="set_cells">\n<atem:parameter name="start">A6</atem:parameter>\n</atem:invoke>\n</atem:function_calls><|eot|>';
    const rendered = renderMuseConversation(conversation.slice(0, 6), (m) => (m === conversation[5] ? raw : undefined));
    expect(rendered).toContain("<|start|>assistant to=self<|message|>Row 6.<|eom|>");
    expect(rendered).toContain('<atem:invoke name="set_cells">');
    expect(rendered.endsWith("<|start|>assistant")).toBe(true);
  });
});

describe("Muse Glimmer tool calls", () => {
  it("converts parameters to the types their schema asks for", () => {
    const parsed = parseMuseCall(
      '\n<atem:invoke name="insert_chart">\n<atem:parameter name="range">A1:C5</atem:parameter>\n<atem:parameter name="width">400</atem:parameter>\n<atem:parameter name="legend">false</atem:parameter>\n</atem:invoke>\n',
      tools,
    );
    expect(parsed).toMatchObject({ name: "insert_chart", arguments: { range: "A1:C5", width: 400, legend: false } });
    expect(
      parseMuseCall(
        '<atem:invoke name="set_cells"><atem:parameter name="start">007</atem:parameter><atem:parameter name="values">[["Total", "=SUM(B2:B6)"]]</atem:parameter></atem:invoke>',
        tools,
      ).arguments,
    ).toEqual({ start: "007", values: [["Total", "=SUM(B2:B6)"]] });
  });

  it("keeps spaces inside a string parameter", () => {
    expect(parseMuseCall('<atem:invoke name="set_cells"><atem:parameter name="start"> A1 </atem:parameter></atem:invoke>', tools).arguments).toEqual({
      start: " A1 ",
    });
  });

  it("reports a parameter that was never closed", () => {
    expect(parseMuseCall('<atem:invoke name="set_cells"><atem:parameter name="start">A1', tools).error).toMatch(/"start" has no <\/atem:parameter>/);
  });

  it("drops channel headers and keeps thinking, text, and calls", async () => {
    const chunks = [
      " to=self<|mes",
      "sage|>The table is A1:C5.<|eom|>",
      "<|start|>assistant to=insert_chart<|message|>",
      '<atem:function_calls>\n<atem:invoke name="insert_chart">\n<atem:parameter name="range">A1:C5</atem:parameter>\n</atem:invoke>\n</atem:function_calls><|eot|>',
    ];
    const model = {
      generate: (_request: unknown, onEvent: (e: unknown) => void) => {
        setTimeout(() => {
          for (const text of chunks) onEvent({ type: "text", text });
          onEvent({ type: "done", reason: "stop", promptTokens: 1, cachedTokens: 0, outputTokens: 1, promptMs: 1, generateMs: 1 });
        });
        return () => {};
      },
    };
    const format = formatFor("muse-glimmer-30b");
    const stream = createLocalStreamFn(model as never, { format })(localModelDescriptor(format.info, "test"), { systemPrompt: "S", messages: [conversation[0]], tools }, {});
    const message = await (await stream).result();
    expect(message.content).toEqual([
      { type: "thinking", thinking: "The table is A1:C5." },
      expect.objectContaining({ type: "toolCall", name: "insert_chart", arguments: { range: "A1:C5" } }),
    ]);
    expect(message.stopReason).toBe("toolUse");
  });

  it("shows a reply on the user channel and hides the header", async () => {
    const model = {
      generate: (_request: unknown, onEvent: (e: unknown) => void) => {
        setTimeout(() => {
          onEvent({ type: "text", text: " to=us" });
          onEvent({ type: "text", text: "er<|message|>Done.<|eot|>" });
          onEvent({ type: "done", reason: "stop", promptTokens: 1, cachedTokens: 0, outputTokens: 1, promptMs: 1, generateMs: 1 });
        });
        return () => {};
      },
    };
    const format = formatFor("muse-glimmer-30b");
    const stream = createLocalStreamFn(model as never, { format })(localModelDescriptor(format.info, "test"), { systemPrompt: "S", messages: [conversation[0]], tools }, {});
    const message = await (await stream).result();
    expect(message.content).toEqual([{ type: "text", text: "Done." }]);
  });
});

describe("Muse Glimmer as a built-in model", () => {
  it("uses Muse markers for the built-in name and FrogNano for any other name", () => {
    expect(formatFor("muse-glimmer-30b").info).toMatchObject({
      id: "muse-glimmer-30b",
      name: "Muse Glimmer 30B",
      stop: ["<|eot|>", "<|end_of_text|>"],
      sampling: { temperature: 1, topK: 64, topP: 0.95 },
    });
    expect(formatFor("muse-glimmer-30B").info.id).toBe("muse-glimmer-30b");
    expect(formatFor("my-model").info.id).toBe("frognano-4b");
    expect(formatFor("gemma-4-e4b").info.id).toBe("gemma-4-e4b");
    expect(AI_MODELS["muse-glimmer-30b"].repo).toBe("meta-models/Muse-Glimmer-30B");
  });

  it("recognizes a Muse Glimmer GGUF from its file name", () => {
    expect(modelIdForFile("/models/Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf")).toBe("muse-glimmer-30b");
    expect(modelIdForFile("/models/FrogNano-4B-2609-Q3_K_M.gguf")).toBe("frognano-4b");
    expect(modelIdForFile("/models/gemma-4-E4B.gguf")).toBe("gemma-4-e4b");
  });

  it("waits for a channel header and drops a finished one", () => {
    expect(skipMuseChannel(" to=us", false)).toBe(-1);
    expect(skipMuseChannel(" to=user<|message|>Hi", false)).toBe(" to=user<|message|>".length);
    expect(skipMuseChannel(" to=self<|message|>", false)).toBe(1);
    expect(skipMuseChannel("<|eom|>", false)).toBe("<|eom|>".length);
    expect(skipMuseChannel("<|eot|>", false)).toBe(0);
  });
});

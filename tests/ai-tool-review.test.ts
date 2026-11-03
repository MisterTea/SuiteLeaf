// @vitest-environment jsdom
import { expect, it } from "vitest";
import { registerAgentHost, toAgentTool, type SuiteTool } from "../apps/web/src/ai/host";
import { reloadAiPreferences, writeAiPreferences } from "../apps/web/src/ai/preferences";
import { acceptHeldEdits, clearHeldEdits, holdToolEdit, rejectHeldEdits, toolEditWaits } from "../apps/web/src/ai/tool-review";

function memoryStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
}

function editingTool(name: string, onRun: () => void): SuiteTool {
  return {
    name,
    label: "Type text",
    description: "Type",
    parameters: { type: "object", properties: {} } as never,
    execute: () => {
      onRun();
      return "secret-value";
    },
  };
}

it("holds a document edit until Accept and does not keep the tool result", async () => {
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, reviewEdits: true });
  clearHeldEdits();
  let ran = false;
  const spec = editingTool("write_text", () => {
    ran = true;
  });
  const unregister = registerAgentHost("editor", {
    kind: "doc",
    snapshot: () => "",
    tools: [spec],
  });
  try {
    const tool = toAgentTool(spec);
    const out = await tool.execute("1", { text: "secret-value" }, undefined);
    expect(ran).toBe(false);
    const text = out.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(text).toBe("This edit is waiting for Accept. The document was not changed.");
    expect(JSON.stringify(out)).not.toContain("secret-value");
    expect(await acceptHeldEdits()).toBe("Accepted the waiting edits.");
    expect(ran).toBe(true);
  } finally {
    unregister();
    clearHeldEdits();
  }
});

it("drops a waiting edit on Reject and still runs a tool that does not edit", async () => {
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, reviewEdits: true });
  clearHeldEdits();
  let ran = false;
  const spec = editingTool("find_and_replace", () => {
    ran = true;
  });
  const read: SuiteTool = {
    name: "read_document",
    label: "Read",
    description: "Read",
    parameters: { type: "object", properties: {} } as never,
    execute: () => "Beds",
  };
  const unregister = registerAgentHost("editor", {
    kind: "doc",
    snapshot: () => "",
    tools: [spec, read],
  });
  try {
    const tool = toAgentTool(spec);
    await tool.execute("1", { find: "secret-value" }, undefined);
    expect(ran).toBe(false);
    expect(rejectHeldEdits()).toBe("Rejected the waiting edits. The document was not changed.");
    expect(ran).toBe(false);
    const looked = await toAgentTool(read).execute("2", {}, undefined);
    const text = looked.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(text).toBe("Beds");
  } finally {
    unregister();
    clearHeldEdits();
  }
});

it("holds formatting and image edits and still runs a read", async () => {
  expect(toolEditWaits("format_text")).toBe(true);
  expect(toolEditWaits("set_line_spacing")).toBe(true);
  expect(toolEditWaits("set_paragraph_spacing")).toBe(true);
  expect(toolEditWaits("set_indent")).toBe(true);
  expect(toolEditWaits("set_tab_stop")).toBe(true);
  expect(toolEditWaits("set_image_wrap")).toBe(true);
  expect(toolEditWaits("set_numbering_restart")).toBe(true);
  expect(toolEditWaits("insert_image")).toBe(true);
  expect(toolEditWaits("undo")).toBe(true);
  expect(toolEditWaits("read_document")).toBe(false);
  expect(toolEditWaits("word_count")).toBe(false);
  expect(toolEditWaits("check_spelling")).toBe(false);
  expect(toolEditWaits("export_document")).toBe(false);
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, reviewEdits: true });
  clearHeldEdits();
  let ran = false;
  const spec = editingTool("set_line_spacing", () => {
    ran = true;
  });
  const unregister = registerAgentHost("editor", {
    kind: "doc",
    snapshot: () => "",
    tools: [spec],
  });
  try {
    const out = await toAgentTool(spec).execute("1", { text: "secret-value" }, undefined);
    expect(ran).toBe(false);
    const text = out.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(text).toBe("This edit is waiting for Accept. The document was not changed.");
    expect(JSON.stringify(out)).not.toContain("secret-value");
    expect(rejectHeldEdits()).toContain("Rejected");
    expect(ran).toBe(false);
  } finally {
    unregister();
    clearHeldEdits();
  }
});

it("holds a spreadsheet edit and a slide edit and still runs a read", async () => {
  expect(toolEditWaits("set_cells")).toBe(true);
  expect(toolEditWaits("set_slide_text")).toBe(true);
  expect(toolEditWaits("read_sheet")).toBe(false);
  expect(toolEditWaits("export_spreadsheet")).toBe(false);
  expect(toolEditWaits("read_presentation")).toBe(false);
  expect(toolEditWaits("export_presentation")).toBe(false);
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, reviewEdits: true });
  clearHeldEdits();
  let ran = false;
  const spec = editingTool("set_cells", () => {
    ran = true;
  });
  const unregister = registerAgentHost("editor", {
    kind: "sheet",
    snapshot: () => "",
    tools: [spec],
  });
  try {
    const out = await toAgentTool(spec).execute("1", { values: "secret-value" }, undefined);
    expect(ran).toBe(false);
    const text = out.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(text).toBe("This edit is waiting for Accept. The document was not changed.");
    expect(JSON.stringify(out)).not.toContain("secret-value");
    expect(rejectHeldEdits()).toContain("Rejected");
    expect(ran).toBe(false);
  } finally {
    unregister();
    clearHeldEdits();
  }
});

it("holds a library delete and still lists files", async () => {
  expect(toolEditWaits("remove_file")).toBe(true);
  expect(toolEditWaits("rename_file")).toBe(true);
  expect(toolEditWaits("empty_trash")).toBe(true);
  expect(toolEditWaits("list_files")).toBe(false);
  expect(toolEditWaits("download_file")).toBe(false);
  expect(toolEditWaits("open_file")).toBe(false);
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, reviewEdits: true });
  clearHeldEdits();
  let ran = false;
  const spec = editingTool("remove_file", () => {
    ran = true;
  });
  const unregister = registerAgentHost("editor", {
    kind: "home",
    snapshot: () => "",
    tools: [spec],
  });
  try {
    const out = await toAgentTool(spec).execute("1", { title: "secret-value" }, undefined);
    expect(ran).toBe(false);
    const text = out.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(text).toBe("This edit is waiting for Accept. The document was not changed.");
    expect(JSON.stringify(out)).not.toContain("secret-value");
    expect(rejectHeldEdits()).toContain("Rejected");
    expect(ran).toBe(false);
  } finally {
    unregister();
    clearHeldEdits();
  }
});

it("does not run an edit after the assistant has stopped", async () => {
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, reviewEdits: false });
  let ran = false;
  const spec = editingTool("write_text", () => {
    ran = true;
  });
  const signal = new AbortController();
  signal.abort();
  const out = await toAgentTool(spec).execute("1", { text: "secret-value" }, signal.signal);
  expect(ran).toBe(false);
  const text = out.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  expect(text).toBe("The assistant stopped. This edit was not run.");
  expect(text).not.toContain("secret-value");
});

it("keeps later edits waiting when one accepted edit fails", async () => {
  clearHeldEdits();
  const ran: string[] = [];
  holdToolEdit(() => {
    ran.push("first");
  });
  holdToolEdit(() => {
    throw new Error("secret-value");
  });
  holdToolEdit(() => {
    ran.push("third");
  });
  const note = await acceptHeldEdits();
  expect(note).toBe("That edit could not be applied. The later edits are still waiting.");
  expect(note).not.toContain("secret-value");
  expect(ran).toEqual(["first"]);
  expect(await acceptHeldEdits()).toBe("Accepted the waiting edits.");
  expect(ran).toEqual(["first", "third"]);
  clearHeldEdits();
});

it("keeps an edit held during Accept when a later edit fails", async () => {
  clearHeldEdits();
  const ran: string[] = [];
  holdToolEdit(() => {
    holdToolEdit(() => {
      ran.push("held");
    });
    ran.push("first");
  });
  holdToolEdit(() => {
    throw new Error("secret-value");
  });
  holdToolEdit(() => {
    ran.push("third");
  });
  const note = await acceptHeldEdits();
  expect(note).toBe("That edit could not be applied. The later edits are still waiting.");
  expect(note).not.toContain("secret-value");
  expect(ran).toEqual(["first"]);
  expect(await acceptHeldEdits()).toBe("Accepted the waiting edits.");
  expect(ran).toEqual(["first", "third", "held"]);
  clearHeldEdits();
});

it("holds opening a sample until Accept", async () => {
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, reviewEdits: true });
  clearHeldEdits();
  let ran = false;
  const spec = editingTool("open_sample", () => {
    ran = true;
  });
  const read: SuiteTool = {
    name: "list_files",
    label: "List",
    description: "List",
    parameters: { type: "object", properties: {} } as never,
    execute: () => "Beds",
  };
  const unregister = registerAgentHost("library", {
    kind: "home",
    snapshot: () => "",
    tools: [spec, read],
  });
  try {
    const out = await toAgentTool(spec).execute("1", { sample: "document" }, undefined);
    expect(ran).toBe(false);
    const text = out.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(text).toBe("This edit is waiting for Accept. The document was not changed.");
    expect(JSON.stringify(out)).not.toContain("secret-value");
    expect(toolEditWaits("list_files")).toBe(false);
    const listed = await toAgentTool(read).execute("2", {}, undefined);
    expect(listed.content.map((part) => (part.type === "text" ? part.text : "")).join("")).toContain(
      "Beds",
    );
    expect(rejectHeldEdits()).toContain("Rejected");
    expect(ran).toBe(false);
  } finally {
    unregister();
    clearHeldEdits();
  }
});

it("holds a spelling correction until Accept", async () => {
  memoryStorage();
  reloadAiPreferences();
  writeAiPreferences({ enabled: true, reviewEdits: true });
  clearHeldEdits();
  let ran = false;
  const spec = editingTool("fix_spelling", () => {
    ran = true;
  });
  const read: SuiteTool = {
    name: "check_spelling",
    label: "Check",
    description: "Check",
    parameters: { type: "object", properties: {} } as never,
    execute: () => "recieve",
  };
  const unregister = registerAgentHost("editor", {
    kind: "doc",
    snapshot: () => "",
    tools: [spec, read],
  });
  try {
    const out = await toAgentTool(spec).execute("1", { word: "recieve" }, undefined);
    expect(ran).toBe(false);
    const text = out.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    expect(text).toBe("This edit is waiting for Accept. The document was not changed.");
    expect(JSON.stringify(out)).not.toContain("secret-value");
    expect(toolEditWaits("check_spelling")).toBe(false);
    const listed = await toAgentTool(read).execute("2", {}, undefined);
    expect(listed.content.map((part) => (part.type === "text" ? part.text : "")).join("")).toContain(
      "recieve",
    );
    expect(rejectHeldEdits()).toContain("Rejected");
    expect(ran).toBe(false);
  } finally {
    unregister();
    clearHeldEdits();
  }
});

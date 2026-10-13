// The assistant's checklist for a request, after pi's todo extension
// (examples/extensions/todo.ts in @earendil-works/pi-coding-agent): the same
// items and actions, with `add` taking a whole list so a small model writes
// its plan in one call, and every result showing the whole list. The agent
// won't accept a final reply while items are open (agent.ts).
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { ToolError, tool, type SuiteTool } from "./host";

export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

let todos: Todo[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const todoStore = {
  get: () => todos,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** A new request starts with an empty list. */
export function clearTodos() {
  todos = [];
  nextId = 1;
  changed();
}

export const openTodos = () => todos.filter((t) => !t.done);

export const formatTodos = (list = todos) =>
  list.length ? list.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n") : "The checklist is empty.";

const status = () => {
  const open = openTodos().length;
  return `${formatTodos()}\n${open ? `${open} of ${todos.length} still to do.` : todos.length ? "Every item is done." : ""}`.trim();
};

export const todoTool: SuiteTool = tool({
  name: "todo",
  label: "Checklist",
  description:
    "Your checklist for the user's request. Actions: add (items: the parts of the request, in order, each a short step in the user's words; only what they asked for), toggle (id or ids: mark items done once you have done them), list, clear. Every result shows the whole list.",
  parameters: Type.Object({
    // A string enum, as in pi's tool: chat templates expect every parameter to have a type.
    action: StringEnum(["add", "toggle", "list", "clear"] as const),
    items: Type.Optional(Type.Array(Type.String(), { description: "For add: one or more steps" })),
    text: Type.Optional(Type.String({ description: "For add: one step" })),
    id: Type.Optional(Type.Number({ description: "For toggle" })),
    ids: Type.Optional(Type.Array(Type.Number(), { description: "For toggle: several items" })),
  }),
  repeatable: true,
  target: () => document.querySelector(".agent-checklist"),
  execute({ action, items, text, id, ids }) {
    switch (action) {
      case "add": {
        const steps = [...(items ?? []), ...(text ? [text] : [])].map((s) => s.trim()).filter(Boolean);
        if (!steps.length) throw new ToolError("Give the steps to add in items, for example items: [\"Make the header bold\", \"Format the totals as dollars\"].");
        for (const step of steps) todos.push({ id: nextId++, text: step, done: false });
        changed();
        return `Added ${steps.length} item(s). Checklist:\n${status()}`;
      }
      case "toggle": {
        const wanted = [...(ids ?? []), ...(id !== undefined ? [id] : [])];
        if (!wanted.length) throw new ToolError(`Give the id of the item to toggle. Checklist:\n${formatTodos()}`);
        const missing = wanted.filter((n) => !todos.some((t) => t.id === n));
        if (missing.length) throw new ToolError(`There is no item #${missing.join(", #")}. Checklist:\n${formatTodos()}`);
        for (const n of wanted) {
          const t = todos.find((x) => x.id === n)!;
          t.done = !t.done;
        }
        changed();
        return `Checklist:\n${status()}`;
      }
      case "list":
        return `Checklist:\n${status()}`;
      case "clear":
        clearTodos();
        return "Cleared the checklist.";
    }
  },
});

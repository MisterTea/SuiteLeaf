import { beforeEach, describe, expect, it } from "vitest";
import { clearTodos, openTodos, todoTool } from "../apps/web/src/ai/todo";
import { renderSystem } from "../apps/web/src/ai/gemma";
import { renderQwenSystem } from "../apps/web/src/ai/qwen";

const todo = async (args: Record<string, unknown>) => (await todoTool.execute(args as never)) as string;

describe("the assistant's checklist", () => {
  beforeEach(() => clearTodos());

  it("adds a whole plan in one call and shows the list after each change", async () => {
    expect(await todo({ action: "add", items: ["Format the rates as dollars", "Make the total row bold"] })).toBe(
      "Added 2 item(s). Checklist:\n[ ] #1: Format the rates as dollars\n[ ] #2: Make the total row bold\n2 of 2 still to do.",
    );
    expect(await todo({ action: "toggle", id: 1 })).toBe(
      "Checklist:\n[x] #1: Format the rates as dollars\n[ ] #2: Make the total row bold\n1 of 2 still to do.",
    );
    expect(openTodos().map((t) => t.text)).toEqual(["Make the total row bold"]);
    expect(await todo({ action: "toggle", ids: [2] })).toContain("Every item is done.");
    expect(openTodos()).toEqual([]);
  });

  it("explains a toggle it can't do, with the list", async () => {
    await todo({ action: "add", text: "Center the headings" });
    await expect(todo({ action: "toggle", id: 4 })).rejects.toThrow("There is no item #4. Checklist:\n[ ] #1: Center the headings");
    await expect(todo({ action: "add", items: [" "] })).rejects.toThrow(/Give the steps to add/);
  });

  it("starts each request empty", async () => {
    await todo({ action: "add", items: ["One"] });
    clearTodos();
    expect(await todo({ action: "list" })).toBe("Checklist:\nThe checklist is empty.");
  });

  it("renders in both models' chat templates (each parameter needs a type)", () => {
    const declared = [{ name: todoTool.name, description: todoTool.description, parameters: todoTool.parameters }];
    expect(renderSystem("S", declared as never)).toContain("declaration:todo{");
    expect(renderQwenSystem("S", declared as never)).toContain('"name": "todo"');
  });
});

describe("which requests get a checklist first", () => {
  it("counts sentences and lists of things to do", async () => {
    const { multiPart } = await import("../apps/web/src/ai/todo");
    expect(multiPart("Engineering's actual is now 13500.")).toBe(false);
    expect(multiPart("Actually, put How you can help before This season's plan.")).toBe(false);
    expect(multiPart("Make a document called Garden plan. Put the heading Spring planting at the top.")).toBe(true);
    expect(multiPart("Show the rates as dollars, the shares as percentages, and make the header bold.")).toBe(true);
  });
});

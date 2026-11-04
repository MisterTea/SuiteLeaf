import { Type } from "@earendil-works/pi-ai";
import type { SuiteFile } from "@suiteleaf/core";
import { ToolError, tool, type SuiteTool } from "../host";
import { instantiate, loadTemplates, saveAsTemplate, type TemplateEntry } from "../../templates/model";
import { templateStore } from "../../templates/store";
import { NAMES, opened, scrolledTo, wait } from "./file-tool-kit";

function templateQuery(name: string) {
  return name
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^the\s+/i, "")
    .replace(/\s+template$/i, "")
    .trim()
    .toLowerCase();
}

function findTemplate(entries: TemplateEntry[], name: string) {
  const n = templateQuery(name);
  const list = entries.map((e) => `"${e.info.name}"`).join(", ") || "none";
  if (!n) throw new ToolError(`Name the template. Templates: ${list}.`);
  const exact = entries.filter((e) => e.info.name.toLowerCase() === n);
  if (exact.length) return exact[0];
  const partial = entries.filter((e) => e.info.name.toLowerCase().includes(n) || n.includes(e.info.name.toLowerCase()));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new ToolError(`No template is called "${name}". Templates: ${list}.`);
  throw new ToolError(
    `Several templates match "${name}": ${partial.map((e) => `"${e.info.name}"`).join(", ")}. Use the exact name.`,
  );
}

function templateHint(entry: TemplateEntry) {
  if (entry.info.kind === "sheet") {
    const file = entry.file;
    const sheet = file.kind === "sheet" ? file.content.workbook.sheets[file.content.workbook.sheetOrder[0]] : undefined;
    const header = sheet?.cellData?.[4]?.[0] as { v?: unknown } | undefined;
    if (header?.v === "Item")
      return " Line items are rows 6 to 8: A is the item, B the quantity, C the price. B2 is the From name. Column D and the Total are formulas; do not type over them.";
    return " Formulas already in the sheet update on their own; do not type over them.";
  }
  if (entry.info.kind === "doc")
    return ' To add a line under a heading, call write_text with after set to that heading. Do not set replace_document.';
  return " Change the slides only if the user asked for changes.";
}

const templateCard = (name: string) =>
  document.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(name)}"]`);

/** List, copy, save, and remove templates. Saving needs the open file. */
export function templateTools(ctx: {
  openNew: (file: SuiteFile) => Promise<void>;
  snapshotFile?: () => Promise<SuiteFile>;
}): SuiteTool[] {
  const listed = (entries: TemplateEntry[]) =>
    entries
      .map((e) => `- "${e.info.name}" (${NAMES[e.info.kind]}, ${e.info.source === "yours" ? "saved by you" : "built-in"}): ${e.info.description}`)
      .join("\n");
  const tools: SuiteTool[] = [
    tool({
      name: "list_templates",
      label: "List templates",
      description:
        "List templates a new file can be copied from. Built-in templates are Invoice, Budget, Project tracker, Meeting notes, Letter, Pitch deck, and Announcement. Templates saved with save_as_template are listed too.",
      parameters: Type.Object({}),
      repeatable: true,
      target: () => document.querySelector(".template-band") ?? document.querySelector(".template-gallery"),
      async execute() {
        const entries = await loadTemplates();
        return entries.length ? listed(entries) : "There are no templates.";
      },
    }),
    tool({
      name: "create_from_template",
      label: "Use template",
      description:
        "Copy a template into a new file and open it. Use this, not create_file, when the user wants a file from a template (Invoice, Meeting notes, Pitch deck, Budget, or a template they saved). Pass title to name the new file. The copy is separate: later edits do not change the template or other files. If a file is open, it is saved first.",
      parameters: Type.Object({
        name: Type.String({ description: "Template name, such as Invoice or Bakery invoice." }),
        title: Type.Optional(Type.String({ description: "Title of the new file. Leave out to use the template's name." })),
      }),
      prepare: (args) => {
        if (args.name == null && typeof args.template === "string") args.name = args.template;
        if (args.title == null && typeof args.file_title === "string") args.title = args.file_title;
        return args;
      },
      target: ({ name }) => templateCard(String(name ?? "")),
      async execute({ name, title }) {
        const entries = await loadTemplates();
        const entry = findTemplate(entries, name);
        const file = instantiate(entry);
        const named = title?.trim();
        if (named) file.title = named.slice(0, 200);
        const from = location.hash;
        try {
          await ctx.openNew(file);
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
        for (let i = 0; i < 200 && location.hash === from; i++) await wait(100);
        for (let i = 0; i < 80; i++) {
          const input = document.querySelector<HTMLInputElement>('[aria-label="File title"]');
          if (location.hash !== from && input?.value === file.title) break;
          await wait(100);
        }
        await wait(300);
        return opened(
          file.kind,
          `Created a ${NAMES[file.kind]} from the "${entry.info.name}" template, called "${file.title}". Editing this file does not change the template or any other file.${templateHint(entry)}`,
        );
      },
    }),
    tool({
      name: "remove_template",
      label: "Remove template",
      description:
        "Remove a template the user saved with save_as_template. Built-in templates cannot be removed. Files already created from it stay in the library. Only when the user asked to remove that template.",
      parameters: Type.Object({
        name: Type.String({ description: "The saved template's name, such as Bakery invoice." }),
      }),
      prepare: (args) => {
        if (args.name == null && typeof args.template === "string") args.name = args.template;
        return args;
      },
      confirm: ({ name }) => `Remove the template "${String(name ?? "").trim()}"? Files made from it stay in the library.`,
      target: ({ name }) =>
        document.querySelector<HTMLElement>(`[aria-label="Actions for ${name}"]`) ?? templateCard(String(name ?? "")),
      async execute({ name }) {
        const entries = await loadTemplates();
        const n = templateQuery(name);
        const yours = entries.filter((e) => e.info.source === "yours" && e.info.name.toLowerCase() === n);
        if (!yours.length) {
          const builtin = entries.find((e) => e.info.source === "builtin" && e.info.name.toLowerCase() === n);
          const saved = entries.filter((e) => e.info.source === "yours").map((e) => `"${e.info.name}"`).join(", ") || "none";
          if (builtin) throw new ToolError(`"${builtin.info.name}" is a built-in template and can't be removed. Saved templates: ${saved}.`);
          throw new ToolError(`No saved template is called "${name}". Saved templates: ${saved}.`);
        }
        for (const entry of yours) await templateStore.remove(entry.info.id);
        const card = templateCard(yours[0].info.name);
        await scrolledTo(card ?? undefined);
        return `Removed the template "${yours[0].info.name}". Files already created from it are still in the library.`;
      },
    }),
  ];
  if (ctx.snapshotFile) {
    const snapshotFile = ctx.snapshotFile;
    tools.push(
      tool({
        name: "save_as_template",
        label: "Save as template",
        description:
          "Save the open file as a template on this computer, under name. The open file stays as it is. Later edits to this file do not change the template. Fill the file in first if the template should include those edits. Do not use a built-in template's name unless the user asked for that name.",
        parameters: Type.Object({
          name: Type.String({ description: "Name of the new template, such as Bakery invoice." }),
        }),
        prepare: (args) => {
          if (args.name == null && typeof args.title === "string") args.name = args.title;
          return args;
        },
        target: () => [...document.querySelectorAll(".file-menu button")].find((b) => b.textContent?.trim() === "File"),
        async execute({ name }) {
          const title = name.trim();
          if (!title) throw new ToolError("Name the template.");
          let file: SuiteFile;
          try {
            file = await snapshotFile();
          } catch (e) {
            throw new ToolError(e instanceof Error ? e.message : String(e));
          }
          const info = await saveAsTemplate(title, file);
          return `Saved "${file.title}" as a template called "${info.name}". This file is unchanged. Later edits to this file do not change the template. create_from_template copies it into a new file.`;
        },
      }),
    );
  }
  return tools;
}

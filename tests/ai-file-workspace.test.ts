// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, serializeFile, type SuiteFile } from "@suiteleaf/core";
import type { SuiteTool } from "../apps/web/src/ai/host";
import { formatVersionList, versionPreview, workspaceSnapshot, workspaceTools, type ListedVersion, type WorkspaceAgentContext } from "../apps/web/src/ai/tools/files";
import { templateTools } from "../apps/web/src/ai/tools/file-template-tools";
import { templateStore } from "../apps/web/src/templates/store";
import { versionWhen } from "../apps/web/src/editors/version-history-model";
import { closeEditor, openEditor, outText, settle, useFileTimers } from "./ai-file-harness";
import { memoryStorage } from "./ai-memory-storage";

beforeEach(async () => {
  useFileTimers();
  memoryStorage();
  document.body.innerHTML = `<div class="workspace-header"><input value="Report" /></div>`;
  location.hash = "#/file/report";
  await templateStore.templates.clear();
});
afterEach(() => {
  closeEditor();
  vi.useRealTimers();
});

function workspace(extra: Partial<WorkspaceAgentContext> = {}) {
  const state = { titles: [] as string[], versions: [] as ListedVersion[], restored: [] as string[], copied: [] as string[], created: [] as string[] };
  const openNew = async (file: SuiteFile) => {
    state.created.push(file.title);
    location.hash = `#/file/${file.id}`;
    document.body.insertAdjacentHTML("beforeend", `<input aria-label="File title" value="${file.title}" />`);
    openEditor(file.kind, `Open ${file.kind}: ${file.title}`);
  };
  const ctx: WorkspaceAgentContext = {
    title: "Report",
    kind: "doc",
    status: "Saved",
    rename: (title) => void state.titles.push(title),
    download: async () => ({ name: "Report.sldoc", path: "/Users/sam/Downloads" }),
    back: async () => openEditor("home", "Screen: the file list."),
    create: async (kind, title) => {
      state.created.push(`${kind}:${title ?? ""}`);
      location.hash = "#/file/new";
      openEditor(kind);
    },
    openNew,
    snapshotFile: async () => createFile("doc", "Report"),
    versions: {
      list: async () => state.versions,
      restore: async (id) => {
        state.restored.push(id);
        document.body.insertAdjacentHTML("beforeend", `<div aria-label="Document content">Watering rota Monday</div>`);
      },
      copy: async (version) => {
        state.copied.push(version.id);
        return `Report (${version.author}).sldoc`;
      },
    },
    ...extra,
  };
  const tools = Object.fromEntries(workspaceTools(ctx).map((t) => [t.name, t])) as Record<string, SuiteTool>;
  const prepared = (name: string, args: Record<string, unknown>) => (tools[name].prepare ? tools[name].prepare!({ ...args }) : args) as never;
  const call = async (name: string, args: Record<string, unknown> = {}) => outText(await settle(() => tools[name].execute(prepared(name, args))));
  const target = (name: string, args: Record<string, unknown> = {}) =>
    settle(() => tools[name].target?.(prepared(name, args))) as Promise<Element | null | undefined>;
  return { state, ctx, tools, call, target, prepared };
}

const at = (daysAgo: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 5, 0, 0);
  return d.toISOString();
};

describe("the open file's window", () => {
  it("types a new title and saves a copy", async () => {
    const { state, call } = workspace();
    expect(await call("rename_this_file", { title: "Plan" })).toBe('The file is now called "Plan".');
    expect(state.titles).toEqual(["P", "Pl", "Pla", "Plan"]);
    expect(await call("download_file")).toBe(
      'Saved "Report.sldoc" to /Users/sam/Downloads: one SuiteLeaf file with the whole document, to keep or move to another computer. open_from_computer opens it again, here or on another computer.',
    );
    const browser = workspace({ download: async () => ({ name: "Report.sldoc" }) });
    expect(await browser.call("download_file")).toMatch(/^Downloaded "Report.sldoc": one SuiteLeaf file/);
    const cancelled = workspace({ download: async () => null });
    expect(await cancelled.call("download_file")).toBe("Nothing was saved: the save was cancelled.");
  });

  it("goes back to the file list and creates a new file from File > New", async () => {
    const { state, call, target, tools } = workspace();
    expect(await call("back_to_files")).toBe("Back on the file list.\nScreen: the file list.");
    expect(await call("create_file", { kind: "presentation", title: "Deck" })).toBe('Created a new presentation called "Deck" and opened it.\nOpen slide editor.');
    expect(state.created).toEqual(["slide:Deck"]);
    await expect(call("create_file", { kind: "poster" })).rejects.toThrow('Unknown kind "poster".');
    document.body.insertAdjacentHTML("beforeend", `<div class="file-menu"><button> File </button></div><button aria-label="Back to files"></button><button class="save-copy"></button>`);
    expect((await target("create_file"))?.textContent).toBe(" File ");
    expect((await target("back_to_files")) as Element).toBe(document.querySelector('[aria-label="Back to files"]'));
    expect((await target("download_file")) as Element).toBe(document.querySelector(".save-copy"));
    expect((await target("rename_this_file")) as Element).toBe(document.querySelector(".workspace-header input"));
    expect(workspaceTools({ ...workspace().ctx, create: undefined }).some((t) => t.name === "create_file")).toBe(false);
    expect(tools.save_as_template).toBeDefined();
  });

  it("describes the open file", () => {
    expect(workspaceSnapshot(workspace().ctx)).toMatch(/^Open file: "Report" \(document\)\. Save status: Saved\. To put a whole earlier version back/);
  });
});

describe("version history", () => {
  const versions = (): ListedVersion[] => [
    { id: "v-current-0001", author: "Sam Okafor", createdAt: at(0, 9), name: null, current: true, preview: "Report | Today" },
    { id: "v-rosa-0002", author: "Rosa Diaz", createdAt: at(1, 18), name: "Agreed", current: false, preview: "Report | Watering rota Monday — Rosa" },
  ];

  it("lists versions newest first and marks the current one", async () => {
    const { state, call } = workspace();
    expect(await call("list_versions")).toBe("This file has no saved versions.");
    state.versions = versions();
    const out = await call("list_versions");
    expect(out).toContain(`1. ${versionWhen(state.versions[0].createdAt)}`);
    expect(out).toContain("· Sam Okafor [current]\n   id: v-current-0001\n   Report | Today");
    expect(out).toContain('· Rosa Diaz "Agreed"\n   id: v-rosa-0002');
    expect(formatVersionList([{ ...state.versions[0], preview: "" }])).toContain("(no text)");
  });

  it("reads which version from loose arguments", () => {
    const { prepared } = workspace();
    expect(prepared("restore_version", { version_id: "v1" })).toEqual({ version: "v1" });
    expect(prepared("restore_version", { author: "Rosa", when: "Yesterday" })).toEqual({ version: "Rosa Yesterday" });
    expect(prepared("copy_version", { which: " " , time: "09:05" })).toEqual({ version: "09:05" });
    expect(prepared("copy_version", { name: "Agreed" })).toEqual({ version: "Agreed" });
  });

  it("restores an earlier version and waits for its text", async () => {
    const { state, call } = workspace();
    state.versions = versions();
    const out = await call("restore_version", { version: "Rosa Diaz" });
    expect(state.restored).toEqual(["v-rosa-0002"]);
    expect(out).toContain(`Restored ${versionWhen(state.versions[1].createdAt)} · Rosa Diaz. The document is that version now.`);
    expect(out.endsWith("Report | Watering rota Monday — Rosa")).toBe(true);
    await expect(call("restore_version", { version: "current" })).rejects.toThrow("is already the current version. Restore an earlier one.");
  });

  it("finds versions by id prefix, name and refuses vague queries", async () => {
    const { state, call } = workspace();
    state.versions = versions();
    expect(await call("copy_version", { version: "v-rosa-00" })).toContain('as "Report (Rosa Diaz).sldoc" in this folder. The open file is unchanged.');
    expect(await call("copy_version", { version: "Agreed" })).toContain("Rosa Diaz");
    expect(state.copied).toEqual(["v-rosa-0002", "v-rosa-0002"]);
    await expect(call("copy_version", { version: "" })).rejects.toThrow("Say which version.");
    await expect(call("copy_version", { version: "the version" })).rejects.toThrow('No single version matches "the version"');
  });

  it("previews the words of a saved file", () => {
    const doc = createFile("doc", "Rota");
    doc.content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " Monday " }] }, { type: "paragraph" }] } as never;
    expect(versionPreview(serializeFile(doc))).toBe("Monday");
    expect(versionPreview(serializeFile(createFile("sheet", "Budget")))).toBe("Budget");
    expect(versionPreview("not a file")).toBe("");
  });
});

describe("templates", () => {
  const tools = (extra: Partial<Parameters<typeof templateTools>[0]> = {}) => {
    const created: SuiteFile[] = [];
    const list = templateTools({
      openNew: async (file) => {
        created.push(file);
        location.hash = `#/file/${file.id}`;
        document.body.insertAdjacentHTML("beforeend", `<input aria-label="File title" value="${file.title}" />`);
        openEditor(file.kind, `Open ${file.title}`);
      },
      ...extra,
    });
    const byName = Object.fromEntries(list.map((t) => [t.name, t])) as Record<string, SuiteTool>;
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      outText(await settle(() => byName[name].execute((byName[name].prepare ? byName[name].prepare!({ ...args }) : args) as never)));
    return { created, byName, call };
  };

  it("lists built-in and saved templates", async () => {
    const { call } = tools();
    await templateStore.save("Bakery invoice", createFile("sheet", "x"));
    const out = await call("list_templates");
    expect(out.split("\n")[0]).toBe('- "Bakery invoice" (spreadsheet, saved by you): A template you saved on this computer.');
    expect(out).toMatch(/- "Invoice" \(spreadsheet, built-in\): /);
  });

  it("copies a template into a new file with hints for each kind", async () => {
    const { created, call } = tools();
    const invoice = await call("create_from_template", { template: "the Invoice template", file_title: "Invoice · Café Lune" });
    expect(created[0].title).toBe("Invoice · Café Lune");
    expect(invoice).toContain('Created a spreadsheet from the "Invoice" template, called "Invoice · Café Lune".');
    expect(invoice).toContain("Line items are rows 6 to 8");
    expect(invoice.endsWith("\nOpen Invoice · Café Lune")).toBe(true);
    expect(await call("create_from_template", { name: "Budget" })).toContain("Formulas already in the sheet update on their own");
    expect(await call("create_from_template", { name: "meeting notes" })).toContain("call write_text with after set to that heading");
    expect(await call("create_from_template", { name: "Pitch deck" })).toContain("Change the slides only if the user asked for changes.");
  });

  it("explains template names it cannot match", async () => {
    const { call } = tools();
    await expect(call("create_from_template", { name: " " })).rejects.toThrow("Name the template. Templates: ");
    await expect(call("create_from_template", { name: "Poster" })).rejects.toThrow('No template is called "Poster".');
    await templateStore.save("Invoice green", createFile("sheet", "x"));
    await templateStore.save("Invoice blue", createFile("sheet", "x"));
    await expect(call("create_from_template", { name: "Invoice " })).resolves.toContain('"Invoice" template');
    await expect(call("create_from_template", { name: "blue" })).resolves.toContain('"Invoice blue" template');
    await expect(call("create_from_template", { name: "voice" })).rejects.toThrow('Several templates match "voice"');
  });

  it("passes on a failure to open the copy", async () => {
    const { call } = tools({ openNew: async () => Promise.reject(new Error("Disk full")) });
    await expect(call("create_from_template", { name: "Letter" })).rejects.toThrow("Disk full");
    const odd = tools({ openNew: async () => Promise.reject("odd") });
    await expect(odd.call("create_from_template", { name: "Letter" })).rejects.toThrow("odd");
  });

  it("removes only templates the user saved", async () => {
    const { call, byName } = tools();
    await templateStore.save("Bakery invoice", createFile("sheet", "x"));
    expect(byName.remove_template.confirm?.({ name: " Bakery invoice " } as never)).toBe('Remove the template "Bakery invoice"? Files made from it stay in the library.');
    await expect(call("remove_template", { name: "Invoice" })).rejects.toThrow('"Invoice" is a built-in template and can\'t be removed. Saved templates: "Bakery invoice".');
    expect(await call("remove_template", { template: "the bakery invoice template" })).toBe(
      'Removed the template "Bakery invoice". Files already created from it are still in the library.',
    );
    expect(await templateStore.list()).toEqual([]);
    await expect(call("remove_template", { name: "Bakery invoice" })).rejects.toThrow('No saved template is called "Bakery invoice". Saved templates: none.');
  });

  it("saves the open file as a template", async () => {
    const { call } = tools({ snapshotFile: async () => createFile("doc", "Minutes") });
    expect(await call("save_as_template", { title: "Club minutes" })).toMatch(/^Saved "Minutes" as a template called "Club minutes"\. This file is unchanged\./);
    expect((await templateStore.list()).map((r) => r.name)).toEqual(["Club minutes"]);
    await expect(call("save_as_template", { name: "  " })).rejects.toThrow("Name the template.");
    const failing = tools({ snapshotFile: async () => Promise.reject(new Error("Not saved yet")) });
    await expect(failing.call("save_as_template", { name: "X" })).rejects.toThrow("Not saved yet");
    const odd = tools({ snapshotFile: async () => Promise.reject("odd") });
    await expect(odd.call("save_as_template", { name: "X" })).rejects.toThrow("odd");
    expect(templateTools({ openNew: async () => {} }).some((t) => t.name === "save_as_template")).toBe(false);
  });

  it("points at the template cards and the File menu", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="template-gallery"></div><button aria-label="Invoice"></button><button aria-label="Actions for Bakery"></button><div class="file-menu"><button>File</button></div>`,
    );
    const { byName } = tools({ snapshotFile: async () => createFile("doc", "x") });
    expect(byName.list_templates.target?.({} as never)).toBe(document.querySelector(".template-gallery"));
    expect(byName.create_from_template.target?.({ name: "Invoice" } as never)).toBe(document.querySelector('[aria-label="Invoice"]'));
    expect(byName.remove_template.target?.({ name: "Bakery" } as never)).toBe(document.querySelector('[aria-label="Actions for Bakery"]'));
    expect(byName.remove_template.target?.({ name: "Invoice" } as never)).toBe(document.querySelector('[aria-label="Invoice"]'));
    expect((byName.save_as_template.target?.({} as never) as Element).textContent).toBe("File");
  });
});

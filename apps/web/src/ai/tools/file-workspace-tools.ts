import { Type } from "@earendil-works/pi-ai";
import type { SuiteFile } from "@suiteleaf/core";
import { versionWhen } from "../../editors/version-history-model";
import { ToolError, currentSnapshot, tool, waitForHost, type SuiteTool } from "../host";
import { moveCursor } from "../cursor";
import { KINDS, NAMES, kindParam, opened, wait, type Kind } from "./file-tool-kit";
import { templateTools } from "./file-template-tools";
import { formatVersionList, pickVersion, type VersionActions } from "./file-versions";

/** What an open file's window (title bar, File menu) lends the agent. */
export interface WorkspaceAgentContext {
  title: string;
  kind: Kind;
  status: string;
  rename: (title: string) => void;
  /** A copy of the open file: its name, and where it went when known; null if cancelled. */
  download: () => Promise<{ name: string; path?: string } | null>;
  back: () => Promise<void>;
  /** File > New: save this file, then create and open a new one. */
  create?: (kind: Kind, title?: string) => Promise<void>;
  /** Save the open file, then save and open `file`. */
  openNew: (file: SuiteFile) => Promise<void>;
  /** Flush the open file and return a copy to store as a template. */
  snapshotFile: () => Promise<SuiteFile>;
  /** Saved versions of the open file (SuiteDrive, or snapshots on this computer). */
  versions: VersionActions;
}

export function workspaceTools(ctx: WorkspaceAgentContext): SuiteTool[] {
  return [
    tool({
      name: "rename_this_file",
      label: "Rename",
      description: "Change the title of the open file.",
      parameters: Type.Object({ title: Type.String() }),
      target: () => document.querySelector(".workspace-header input"),
      async execute({ title }) {
        const input = document.querySelector<HTMLInputElement>(".workspace-header input");
        input?.focus();
        for (let i = 1; i <= title.length; i++) {
          ctx.rename(title.slice(0, i));
          await wait(30);
        }
        input?.blur();
        return `The file is now called "${title}".`;
      },
    }),
    tool({
      name: "download_file",
      label: "Save a copy",
      description:
        "Save a copy of the open file as one SuiteLeaf file that keeps everything in it, to keep or move to another computer. Use this when the user asks to download or save the file. Export tools are only for a copy in another format, such as Word, Excel or CSV.",
      parameters: Type.Object({}),
      target: () => document.querySelector(".save-copy"),
      async execute() {
        const saved = await ctx.download();
        if (!saved) return "Nothing was saved: the save was cancelled.";
        return `${saved.path ? `Saved "${saved.name}" to ${saved.path}` : `Downloaded "${saved.name}"`}: one SuiteLeaf file with the whole ${NAMES[ctx.kind]}, to keep or move to another computer. open_from_computer opens it again, here or on another computer.`;
      },
    }),
    tool({
      name: "back_to_files",
      label: "Back to files",
      description:
        "Close the open file and go back to the file list. Files save automatically, so never close a file just to save it: only do this when the user asks to go back or the task needs another file.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Back to files"]'),
      async execute() {
        await ctx.back();
        await waitForHost("home");
        return `Back on the file list.\n${currentSnapshot()}`;
      },
    }),
    ...(ctx.create
      ? [
          tool({
            name: "create_file",
            label: "New file",
            description: "Create a new document, spreadsheet or presentation (File > New) and open it. This file is saved first. Give a title if the user named it.",
            parameters: Type.Object({ kind: kindParam, title: Type.Optional(Type.String()) }),
            target: () => [...document.querySelectorAll(".file-menu button")].find((b) => b.textContent?.trim() === "File"),
            async execute({ kind, title }) {
              const k = KINDS[kind];
              if (!k) throw new ToolError(`Unknown kind "${kind}".`);
              const from = location.hash;
              await ctx.create!(k, title);
              for (let i = 0; i < 200 && location.hash === from; i++) await wait(100);
              // The old file's editor leaves once the new one's route renders.
              await wait(300);
              return opened(k, `Created a new ${kind}${title ? ` called "${title}"` : ""} and opened it.`);
            },
          }),
        ]
      : []),
    ...templateTools({ openNew: ctx.openNew, snapshotFile: ctx.snapshotFile }),
    ...versionTools(ctx),
  ];
}

const versionButton = () => document.querySelector('[aria-label="Version history"]');

function versionTools(ctx: WorkspaceAgentContext): SuiteTool[] {
  const history = () => ctx.versions.list();
  return [
    tool({
      name: "list_versions",
      label: "Version history",
      description:
        "List saved versions of the open file, newest first. Each line has when it was saved, who saved it, its id, and its text. The current version is marked [current]. Call this before restore_version.",
      parameters: Type.Object({}),
      target: () => versionButton(),
      async execute() {
        const versions = await history();
        return formatVersionList(versions);
      },
    }),
    tool({
      name: "restore_version",
      label: "Restore version",
      description:
        "Put a whole earlier saved version back as the open file. Pass version as the id from list_versions, or the author and time, such as \"Rosa Diaz\" or \"Yesterday 18:02\". The version you replace stays in the history, so it is not deleted. Do not retype the old text. This replaces every paragraph. To put one paragraph back and leave the rest, call restore_paragraph instead.",
      parameters: Type.Object({
        version: Type.String({ description: "Version id, or the author and time from list_versions." }),
      }),
      prepare: (args) => {
        const named = args.version ?? args.version_id ?? args.id ?? args.which ?? args.name;
        if (typeof named === "string" && named.trim()) return { version: named };
        const parts = [args.author, args.when, args.time].filter((part) => typeof part === "string");
        return { version: parts.join(" ") };
      },
      target: () => versionButton(),
      async execute({ version }) {
        const versions = await history();
        const picked = pickVersion(versions, version);
        if (picked.current)
          throw new ToolError(
            `${versionWhen(picked.createdAt)} · ${picked.author} is already the current version. Restore an earlier one.\n${formatVersionList(versions)}`,
          );
        await ctx.versions.restore(picked.id);
        const marker = picked.preview.split(" | ").find((line) => line && line !== ctx.title) ?? "";
        for (let i = 0; i < 30; i++) {
          const editor = document.querySelector('[aria-label="Document content"], [aria-label="Spreadsheet"], [aria-label="Slide canvas"]');
          if (!marker || editor?.textContent?.includes(marker.slice(0, 24))) break;
          await wait(100);
        }
        await moveCursor(document.querySelector('[aria-label="Document content"]') ?? versionButton(), "Restored");
        const when = `${versionWhen(picked.createdAt)} · ${picked.author}`;
        return `Restored ${when}. The document is that version now. The version you replaced is still in the history, so it was not lost. Do not type over the document.\n${picked.preview}`;
      },
    }),
    tool({
      name: "copy_version",
      label: "Copy a version",
      description:
        "Save one version as its own file in the same folder, named with the author and the time. The open file stays as it is. Restoring already keeps every version in the history, so only do this when the user asked for a separate file.",
      parameters: Type.Object({
        version: Type.String({ description: "Version id, or the author and time from list_versions." }),
      }),
      prepare: (args) => {
        const named = args.version ?? args.version_id ?? args.id ?? args.which ?? args.name;
        if (typeof named === "string" && named.trim()) return { version: named };
        const parts = [args.author, args.when, args.time].filter((part) => typeof part === "string");
        return { version: parts.join(" ") };
      },
      target: () => versionButton(),
      async execute({ version }) {
        const versions = await history();
        const picked = pickVersion(versions, version);
        const filename = await ctx.versions.copy(picked);
        return `Saved a copy of ${versionWhen(picked.createdAt)} · ${picked.author} as "${filename}" in this folder. The open file is unchanged.`;
      },
    }),
  ];
}

export const workspaceSnapshot = (ctx: WorkspaceAgentContext) =>
  `Open file: "${ctx.title}" (${NAMES[ctx.kind]}). Save status: ${ctx.status}. To put a whole earlier version back, call list_versions, then restore_version with that version's author and time. Restoring keeps every other version in the history. To put one paragraph back and leave the rest of the document, call restore_paragraph with the version's name.`;

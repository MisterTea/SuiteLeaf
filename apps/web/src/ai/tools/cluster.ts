import { Type } from "@earendil-works/pi-ai";
import type { SuiteFile } from "@suiteleaf/core";
import type { DriveControl } from "../../drive/DriveBrowser";
import type { DriveItem } from "../../node-client";
import { agentSession } from "../agent";
import { moveCursor } from "../cursor";
import { ToolError, currentSnapshot, tool, waitForHost, type SuiteTool } from "../host";

type Kind = SuiteFile["kind"];
const KINDS: Record<string, Kind> = { document: "doc", spreadsheet: "sheet", presentation: "slide" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Single-node home: connecting to a team's server. */
export function connectTools(ctx: { probe: (address: string) => Promise<string>; connect: (url: string) => Promise<void> }): SuiteTool[] {
  return [
    tool({
      name: "connect_to_server",
      label: "Connect to a server",
      description:
        "Connect SuiteLeaf to the team's SuiteLeaf server at `address` (for example https://suiteleaf.example.org or 192.168.1.20:8787). Files then live in SuiteDrive on that server. The page reloads; the user then signs in themselves.",
      parameters: Type.Object({ address: Type.String() }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Connect to a server")),
      async execute({ address }) {
        const url = await ctx.probe(address).catch((e: Error) => {
          throw new ToolError(e.message);
        });
        return agentSession.reloadAndResume(`Connected to the SuiteLeaf server at ${url}. The app reloaded.`, () =>
          ctx.connect(url),
        );
      },
    }),
  ];
}

/** The sign-in screen of a server: only the user can sign in. */
export function signInTools(ctx: {
  host: string;
  signedIn: () => boolean;
  canLeave: boolean;
  leave: () => Promise<void>;
}): SuiteTool[] {
  return [
    tool({
      name: "wait_for_sign_in",
      label: "Waiting for you to sign in",
      description:
        "Wait while the user signs in or creates an account on the sign-in screen (you never type passwords). Returns once they are signed in, or after a few minutes.",
      parameters: Type.Object({}),
      // Just above the card, clear of the fields the user types into.
      target: () => {
        const r = document.querySelector('[aria-label="Sign in to SuiteLeaf"]')?.getBoundingClientRect();
        return r && { x: r.left + r.width / 2, y: r.top - 28 };
      },
      async execute() {
        for (let i = 0; i < 1800; i++) {
          if (ctx.signedIn()) {
            await waitForHost("home", 30000).catch(() => {});
            for (let j = 0; j < 50 && currentSnapshot().includes(DRIVE_LOADING); j++) await wait(100);
            const chip = document.querySelector(".account-chip")?.getBoundingClientRect();
            await moveCursor(chip && { x: chip.right - 20, y: chip.top + 18 }, "Signed in");
            return `The user signed in to ${ctx.host}. New files are saved to SuiteDrive on that server; the files on this computer are kept and come back when they disconnect.\n${currentSnapshot()}`;
          }
          await wait(200);
        }
        return "The user has not signed in yet.";
      },
    }),
    ...(ctx.canLeave
      ? [
          tool({
            name: "disconnect",
            label: "Work on this computer",
            description: "Leave this server and go back to working with files on this computer. The page reloads.",
            parameters: Type.Object({}),
            target: () =>
              [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Work on this computer")),
            execute: () =>
              agentSession.reloadAndResume(`Disconnected from ${ctx.host}; files now live on this computer.`, ctx.leave),
          }),
        ]
      : []),
  ];
}

export const signInSnapshot = (host: string) =>
  `Screen: sign in to the SuiteLeaf server ${host}. Only the user can sign in or create an account here; ask them to, then call wait_for_sign_in.`;

/** Cluster home: SuiteDrive. */
export interface DriveAgentContext {
  host: string;
  user: string;
  drive: () => DriveControl | null;
  create: (kind: Kind, title?: string) => Promise<void>;
  open: (item: DriveItem) => Promise<void>;
  signOut: () => Promise<boolean>;
  canDisconnect: boolean;
  disconnect: () => Promise<void>;
}

const describeItem = (i: DriveItem) =>
  `${i.kind === "folder" ? "📁 " : ""}"${i.name}"${i.available ? "" : " (still copying from another server)"}`;

export function driveTools(ctx: DriveAgentContext): SuiteTool[] {
  const control = () => {
    const c = ctx.drive();
    if (!c) throw new ToolError("SuiteDrive is not showing.");
    return c;
  };
  const find = (name: string, kind?: "folder") => {
    const items = control().items.filter((i) => !kind || i.kind === kind);
    const n = name.toLowerCase();
    const item =
      items.find((i) => i.name.toLowerCase() === n) ??
      items.find((i) => i.name.toLowerCase().replace(/\.(sldoc|slsheet|slslides)$/, "") === n) ??
      items.find((i) => i.name.toLowerCase().includes(n));
    if (!item)
      throw new ToolError(`Nothing called "${name}" in ${control().path.join(" › ")}. Here: ${items.map(describeItem).join(", ") || "nothing"}.`);
    return item;
  };
  const row = (name: string) => document.querySelector(`.drive-item[aria-label="${CSS.escape(name)}"]`);
  const offScreen = (el?: Element | null) => {
    const r = el?.getBoundingClientRect();
    return !!r && (r.top < 0 || r.bottom > innerHeight);
  };
  /** SuiteDrive sits below the New buttons: scroll it (then `el`) into view, so the user sees the pointer and the change. */
  const onScreen = async <T extends Element | null | undefined>(el: T, drive = true): Promise<T> => {
    const section = document.querySelector(".drive-browser")?.closest("section");
    if (drive && offScreen(section)) {
      section!.scrollIntoView({ behavior: "smooth", block: "start" });
      await wait(500);
    }
    if (offScreen(el)) {
      el!.scrollIntoView({ behavior: "smooth", block: "center" });
      await wait(500);
    }
    return el;
  };
  return [
    tool({
      name: "list_drive",
      label: "SuiteDrive",
      description: "List the folders and files in the SuiteDrive folder on screen.",
      parameters: Type.Object({}),
      target: () => onScreen(document.querySelector(".drive-list")),
      execute() {
        const c = control();
        return `${c.path.join(" › ")}: ${c.items.map(describeItem).join(", ") || "empty"}`;
      },
    }),
    tool({
      name: "open_folder",
      label: "Open folder",
      description: "Open a folder in SuiteDrive. Use the name \"My Drive\" to go back to the top.",
      parameters: Type.Object({ name: Type.String() }),
      target: ({ name }) =>
        onScreen(
          name.toLowerCase() === "my drive"
            ? document.querySelector(".drive-crumbs button")
            : row(find(name, "folder").name),
        ),
      async execute({ name }) {
        const c = control();
        if (name.toLowerCase() === "my drive") c.goTo(1);
        else c.choose(find(name, "folder"));
        for (let i = 0; i < 40 && (ctx.drive()?.loading ?? true); i++) await wait(100);
        await wait(200);
        const now = control();
        return `In ${now.path.join(" › ")}: ${now.items.map(describeItem).join(", ") || "empty"}`;
      },
    }),
    tool({
      name: "new_folder",
      label: "New folder",
      description: "Make a new folder in the SuiteDrive folder on screen.",
      parameters: Type.Object({ name: Type.String() }),
      target: () => onScreen(document.querySelector(".drive-new-folder")),
      async execute({ name }) {
        await control().newFolder(name);
        return `Made the folder "${name}" in ${control().path.join(" › ")}.`;
      },
    }),
    tool({
      name: "create_file",
      label: "New file",
      description:
        "Create a new document, spreadsheet or presentation in SuiteDrive, in the folder on screen, and open it. Give a title if the user named it.",
      parameters: Type.Object({
        kind: Type.String({ enum: ["document", "spreadsheet", "presentation"] }),
        title: Type.Optional(Type.String()),
      }),
      target: ({ kind }) =>
        onScreen(
          [...document.querySelectorAll(".new-card")].find((b) => b.textContent?.toLowerCase().includes(`new ${kind}`)),
          false,
        ),
      async execute({ kind, title }) {
        const k = KINDS[kind];
        if (!k) throw new ToolError(`Unknown kind "${kind}".`);
        const folder = control().path.at(-1);
        await ctx.create(k, title);
        await waitForHost(k);
        return `Created ${title ? `"${title}"` : `a new ${kind}`} in ${folder} and opened it.\n${currentSnapshot()}`;
      },
    }),
    tool({
      name: "open_file",
      label: "Open file",
      description: "Open a file from the SuiteDrive folder on screen.",
      parameters: Type.Object({ name: Type.String() }),
      target: ({ name }) => {
        try {
          return onScreen(row(find(name).name));
        } catch {
          return undefined;
        }
      },
      async execute({ name }) {
        const item = find(name);
        if (item.kind === "folder") throw new ToolError(`"${item.name}" is a folder; use open_folder.`);
        await ctx.open(item);
        const kind = /\.slsheet$/.test(item.name) ? "sheet" : /\.slslides$/.test(item.name) ? "slide" : "doc";
        await waitForHost(kind);
        return `Opened "${item.name}".\n${currentSnapshot()}`;
      },
    }),
    tool({
      name: "sign_out",
      label: "Sign out",
      description: "Sign out of this server (stay connected to it, ready for someone to sign in).",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Sign out"]'),
      async execute() {
        if (!(await ctx.signOut())) return "The user chose not to sign out.";
        return `Signed out of ${ctx.host}.`;
      },
    }),
    ...(ctx.canDisconnect
      ? [
          tool({
            name: "disconnect",
            label: "Disconnect",
            description: "Sign out and disconnect from this server, going back to files on this computer. The page reloads.",
            parameters: Type.Object({}),
            target: () => document.querySelector('[aria-label="Disconnect from server"]'),
            execute: () =>
              agentSession.reloadAndResume(`Disconnected from ${ctx.host}; files now live on this computer.`, ctx.disconnect),
          }),
        ]
      : []),
  ];
}

const DRIVE_LOADING = "still loading";

export function driveSnapshot(ctx: DriveAgentContext) {
  const c = ctx.drive();
  const items = c?.loading ? DRIVE_LOADING : c?.items.map(describeItem).join(", ") || "empty";
  return `Screen: SuiteDrive on ${ctx.host}, signed in as ${ctx.user}.${c ? ` Folder ${c.path.join(" › ")}: ${items}.` : ""}`;
}

/** An open file's SuiteDrive conflict banner. */
export function conflictTools(ctx: {
  conflict: () => boolean;
  saveCopy: () => Promise<void>;
  reload: () => Promise<void>;
  title: () => string;
  rename: (title: string) => void;
}): SuiteTool[] {
  return [
    tool({
      name: "resolve_conflict",
      label: "Resolve conflict",
      description:
        "When someone else saved this file in SuiteDrive first: save_copy keeps your version as a separate copy (nothing is lost), named copy_name if the user gave a name for it; reload replaces your edits with their version (your edits are lost; only if the user said so). The page reloads after reload.",
      parameters: Type.Object({
        choice: Type.String({ enum: ["save_copy", "reload"] }),
        copy_name: Type.Optional(Type.String()),
      }),
      target: ({ choice }) =>
        [...document.querySelectorAll(".drive-conflict button")].find((b) =>
          b.textContent?.includes(choice === "save_copy" ? "Save as copy" : "Reload"),
        ),
      async execute({ choice, copy_name }) {
        if (!ctx.conflict()) return "There is no conflict on this file.";
        if (choice === "save_copy") {
          const original = ctx.title();
          await ctx.saveCopy();
          const name = copy_name?.trim().replace(/\.(sldoc|slsheet|slslides)$/i, "");
          if (name && name !== original) {
            const input = document.querySelector<HTMLInputElement>(".workspace-header input");
            await moveCursor(input, "Name the copy");
            input?.focus();
            for (let i = 1; i <= name.length; i++) {
              ctx.rename(name.slice(0, i));
              await wait(30);
            }
            input?.blur();
          }
          const now = ctx.title();
          return `Saved your version as a separate file in SuiteDrive called "${now}"; that copy is now the open file. The other person's version is still "${original}", unchanged.${
            now === original ? ` Both files have the same name; rename_this_file gives the open copy its own name if the user wants.` : ""
          }`;
        }
        return agentSession.reloadAndResume("Reloaded the file from SuiteDrive; it now shows the other version.", ctx.reload);
      },
    }),
  ];
}

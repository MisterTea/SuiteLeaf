import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  WebContentsView,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import {
  hashPath,
  isExternalWebUrl,
  openablePath,
  openablePathFromUrl,
  tabKey,
} from "./tab-url";

const TAB_LIMIT = 16;

export interface DesktopTabState {
  id: string;
  title: string;
  active: boolean;
}

interface PageTab {
  id: string;
  title: string;
  path: string;
  contents: WebContents;
  /** Null for the window's own page. Extra documents are WebContentsViews. */
  view: WebContentsView | null;
  dirty: boolean;
  closing: boolean;
  allowClose: boolean;
  /** The HTML title arrives before the page names the document. Ignore that one. */
  sawTitle: boolean;
}

export interface WindowTabs {
  pages(): WebContents[];
  isPage(contents: WebContents): boolean;
  activeContents(): WebContents | undefined;
  reloadAll(): void;
  openPath(path: string, title?: string): void;
  newTab(): void;
  closeActive(): void;
  beginWindowClose(): void;
  cancelWindowClose(): void;
}

let host: Host | null = null;
let ipcReady = false;

function cleanTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function appBase(): string {
  return process.env.ELECTRON_RENDERER_URL || "suiteleaf://app/index.html";
}

function appUrl(path: string): string {
  const url = new URL(appBase());
  url.hash = path;
  return url.toString();
}

class Host {
  readonly shell: PageTab;
  readonly extras: PageTab[] = [];
  order: PageTab[];
  activeId: string;
  shuttingDown = false;

  constructor(
    readonly win: BrowserWindow,
    readonly preload: string,
    readonly onDirty: (dirty: boolean) => void,
  ) {
    this.shell = {
      id: randomUUID(),
      title: "Files",
      path: "/",
      contents: win.webContents,
      view: null,
      dirty: false,
      closing: false,
      allowClose: false,
      sawTitle: false,
    };
    this.order = [this.shell];
    this.activeId = this.shell.id;
    this.wire(this.shell);
    this.win.on("resize", () => this.layout());
    this.win.on("closed", () => {
      // The window destroys its child views. Drop the bookkeeping so a later window can attach.
      this.extras.length = 0;
      this.order = [];
      if (host === this) host = null;
    });
    this.publishDirty();
    this.updateWindowTitle();
  }

  pages(): WebContents[] {
    return [this.shell, ...this.extras]
      .map((tab) => tab.contents)
      .filter((contents) => !contents.isDestroyed());
  }

  isPage(contents: WebContents): boolean {
    return this.pages().includes(contents);
  }

  activeContents(): WebContents | undefined {
    const tab = this.order.find((item) => item.id === this.activeId) ?? this.shell;
    return tab.contents.isDestroyed() ? undefined : tab.contents;
  }

  reloadAll() {
    for (const contents of this.pages()) contents.reload();
  }

  snapshot(): DesktopTabState[] {
    return this.order.map((tab) => ({
      id: tab.id,
      title: tab.title,
      active: tab.id === this.activeId,
    }));
  }

  layout() {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    for (const tab of this.extras) {
      if (tab.view) tab.view.setBounds({ x: 0, y: 0, width, height });
    }
  }

  openPath(path: string, title?: string) {
    const key = tabKey(path);
    if (key.startsWith("file:") || key.startsWith("shared:")) {
      const existing = this.order.find((tab) => tabKey(tab.path) === key);
      if (existing) {
        this.activate(existing);
        return;
      }
    }
    if (this.order.length >= TAB_LIMIT) {
      this.tell(new Error("Close a tab before opening another."));
      return;
    }
    if (path === "/" && !this.order.includes(this.shell)) {
      this.order.push(this.shell);
      this.shell.title = cleanTitle(title) || "Files";
      if (hashPath(this.shell.contents.getURL()) !== "/")
        void this.shell.contents.executeJavaScript("location.hash='#/'").catch(() => {});
      this.activate(this.shell);
      return;
    }
    this.createView(path, cleanTitle(title) || (path === "/" ? "Files" : "SuiteLeaf"));
  }

  newTab() {
    this.openPath("/");
  }

  closeActive() {
    const tab = this.order.find((item) => item.id === this.activeId);
    if (tab) this.close(tab.id);
  }

  show(id: string) {
    const tab = this.order.find((item) => item.id === id);
    if (!tab) throw new Error("That tab is closed.");
    this.activate(tab);
  }

  dismiss(id: string) {
    this.close(id);
  }

  beginWindowClose() {
    this.shuttingDown = true;
  }

  cancelWindowClose() {
    this.shuttingDown = false;
  }

  setDirty(contents: WebContents, dirty: boolean) {
    const tab = this.tabFor(contents);
    if (!tab || tab.dirty === dirty) return;
    tab.dirty = dirty;
    this.publishDirty();
  }

  private tabFor(contents: WebContents): PageTab | undefined {
    if (this.shell.contents === contents) return this.shell;
    return this.extras.find((tab) => tab.contents === contents);
  }

  private publishDirty() {
    const dirty = [this.shell, ...this.extras].some((tab) => tab.dirty);
    this.onDirty(dirty);
    if (!this.win.isDestroyed()) this.win.setDocumentEdited?.(dirty);
  }

  private emit() {
    const list = this.snapshot();
    for (const contents of this.pages()) contents.send("tabs:changed", list);
    this.updateWindowTitle();
  }

  private updateWindowTitle() {
    if (this.win.isDestroyed()) return;
    const tab = this.order.find((item) => item.id === this.activeId);
    const title = tab?.title || "SuiteLeaf";
    this.win.setTitle(title === "SuiteLeaf" ? "SuiteLeaf" : `${title} — SuiteLeaf`);
  }

  private activate(tab: PageTab) {
    this.activeId = tab.id;
    for (const extra of this.extras) extra.view?.setVisible(extra.id === tab.id);
    if (!tab.contents.isDestroyed()) tab.contents.focus();
    this.emit();
  }

  private tell(error: unknown) {
    if (this.win.isDestroyed()) return;
    dialog.showMessageBox(this.win, {
      type: "info",
      message: error instanceof Error ? error.message : "That document can't be opened in a tab.",
    });
  }

  private confirmDiscard(): boolean {
    if (this.win.isDestroyed()) return true;
    return (
      dialog.showMessageBoxSync(this.win, {
        type: "warning",
        buttons: ["Keep editing", "Close"],
        defaultId: 0,
        cancelId: 0,
        message: "Changes are still being saved.",
        detail:
          "Keep this tab open until the save completes. Closing now may lose the latest edits.",
      }) === 1
    );
  }

  private close(id: string) {
    const tab = this.order.find((item) => item.id === id);
    if (!tab || this.win.isDestroyed()) return;
    if (this.order.length === 1) {
      this.win.close();
      return;
    }
    if (!tab.view) {
      this.retireShell();
      return;
    }
    this.closeView(tab);
  }

  /** The window page cannot be destroyed on its own, so closing it returns that page home and hides the tab. */
  private retireShell() {
    if (this.shell.dirty && !this.confirmDiscard()) return;
    this.order = this.order.filter((tab) => tab !== this.shell);
    if (hashPath(this.shell.contents.getURL()) !== "/")
      void this.shell.contents.executeJavaScript("location.hash='#/'").catch(() => {});
    const next = this.order[this.order.length - 1];
    if (!next) this.order.push(this.shell);
    this.activate(next ?? this.shell);
  }

  private closeView(tab: PageTab) {
    if (tab.closing || !tab.view) return;
    const contents = tab.contents;
    if (contents.isDestroyed()) {
      this.removeView(tab);
      return;
    }
    const onPrevent = (event: Electron.Event) => {
      if (this.shuttingDown || tab.allowClose) {
        event.preventDefault();
        return;
      }
      if (this.confirmDiscard()) {
        tab.allowClose = true;
        event.preventDefault();
        return;
      }
      tab.closing = false;
    };
    contents.on("will-prevent-unload", onPrevent);
    tab.closing = true;
    if (tab.dirty && !this.shuttingDown) {
      if (!this.confirmDiscard()) {
        tab.closing = false;
        contents.removeListener("will-prevent-unload", onPrevent);
        return;
      }
      tab.allowClose = true;
    }
    contents.once("destroyed", () => this.removeView(tab));
    contents.close({ waitForBeforeUnload: true });
  }

  private removeView(tab: PageTab) {
    if (!this.extras.includes(tab)) return;
    this.extras.splice(this.extras.indexOf(tab), 1);
    this.order = this.order.filter((item) => item !== tab);
    if (tab.view && !this.win.isDestroyed()) {
      try {
        this.win.contentView.removeChildView(tab.view);
      } catch {
        // The window is already tearing the view down.
      }
    }
    tab.dirty = false;
    this.publishDirty();
    if (!this.order.length) this.order.push(this.shell);
    if (this.activeId === tab.id) this.activate(this.order[this.order.length - 1] ?? this.shell);
    else this.emit();
  }

  private createView(path: string, title: string) {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor("#f8f9fa");
    const tab: PageTab = {
      id: randomUUID(),
      title,
      path,
      contents: view.webContents,
      view,
      dirty: false,
      closing: false,
      allowClose: false,
      sawTitle: false,
    };
    this.extras.push(tab);
    this.order.push(tab);
    this.wire(tab);
    this.win.contentView.addChildView(view);
    this.layout();
    view.setVisible(false);
    void view.webContents.loadURL(appUrl(path));
    this.activate(tab);
  }

  private wire(tab: PageTab) {
    const contents = tab.contents;
    contents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      const name = cleanTitle(title);
      if (!name) return;
      if (name === "SuiteLeaf" && !tab.sawTitle && tab.title !== "SuiteLeaf") {
        tab.sawTitle = true;
        return;
      }
      tab.sawTitle = true;
      if (tab.title === name) return;
      tab.title = name;
      this.emit();
    });
    const remember = (_event: unknown, url: string) => {
      const path = hashPath(url);
      if (path) tab.path = path;
    };
    contents.on("did-navigate", remember);
    contents.on("did-navigate-in-page", remember);
    contents.setWindowOpenHandler(({ url }) => {
      const path = openablePathFromUrl(url, appBase());
      if (path && path !== "/") {
        try {
          this.openPath(path);
        } catch (error) {
          this.tell(error);
        }
      } else if (isExternalWebUrl(url, appBase())) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      const current = contents.getURL();
      // The first load has no current page. Later loads must stay on this app.
      if (!current || current === "about:blank") return;
      if (url.split("#")[0] !== current.split("#")[0]) event.preventDefault();
    });
    contents.on("render-process-gone", () => {
      if (tab.view) this.removeView(tab);
    });
  }
}

function requireHost(event: IpcMainInvokeEvent): Host {
  if (
    !host ||
    !host.isPage(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error("Unauthorized request.");
  return host;
}

function registerIpc() {
  if (ipcReady) return;
  ipcReady = true;
  ipcMain.handle("tabs:list", (event) => requireHost(event).snapshot());
  ipcMain.handle("tabs:open", (event, path: unknown, title: unknown) => {
    const current = requireHost(event);
    if (typeof path !== "string" || (title !== undefined && typeof title !== "string"))
      throw new Error("Invalid tab.");
    const ok = openablePath(path);
    if (!ok) throw new Error("That document can't be opened in a tab.");
    current.openPath(ok, typeof title === "string" ? title : undefined);
  });
  ipcMain.handle("tabs:activate", (event, id: unknown) => {
    const current = requireHost(event);
    if (typeof id !== "string") throw new Error("Invalid tab.");
    current.show(id);
  });
  ipcMain.handle("tabs:close", (event, id: unknown) => {
    const current = requireHost(event);
    if (typeof id !== "string") throw new Error("Invalid tab.");
    current.dismiss(id);
  });
  ipcMain.on("dirty", (event, value) => {
    if (!host || typeof value !== "boolean" || !host.isPage(event.sender)) return;
    if (event.senderFrame !== event.sender.mainFrame) return;
    host.setDirty(event.sender, value);
  });
}

/**
 * The first tab is the window's own page, so existing window commands keep
 * working. Each further document is a WebContentsView covering that page.
 */
export function attachWindowTabs(
  win: BrowserWindow,
  preload: string,
  onDirty: (dirty: boolean) => void,
): WindowTabs {
  registerIpc();
  host = new Host(win, preload, onDirty);
  const current = host;
  return {
    pages: () => current.pages(),
    isPage: (contents) => host === current && current.isPage(contents),
    activeContents: () => (host === current ? current.activeContents() : undefined),
    reloadAll: () => current.reloadAll(),
    openPath: (path, title) => current.openPath(path, title),
    newTab: () => current.newTab(),
    closeActive: () => current.closeActive(),
    beginWindowClose: () => current.beginWindowClose(),
    cancelWindowClose: () => current.cancelWindowClose(),
  };
}

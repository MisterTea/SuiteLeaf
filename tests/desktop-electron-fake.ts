import { vi } from "vitest";

type Listener = (...args: any[]) => any;

export class Emitter {
  listeners = new Map<string, Listener[]>();
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  once(event: string, listener: Listener) {
    const wrapped: Listener = (...args) => {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((l) => l !== wrapped),
      );
      return listener(...args);
    };
    return this.on(event, wrapped);
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

export class FakeContents extends Emitter {
  url = "suiteleaf://app/index.html";
  mainFrame = { name: "main" };
  sent: unknown[][] = [];
  loaded: string[] = [];
  permissionRequest?: Listener;
  permissionCheck?: Listener;
  headers?: Listener;
  openHandler?: Listener;
  printers: unknown[] = [];
  printResult: [boolean, string] = [true, ""];
  reload = vi.fn();
  session = {
    setPermissionRequestHandler: (handler: Listener) =>
      (this.permissionRequest = handler),
    setPermissionCheckHandler: (handler: Listener) =>
      (this.permissionCheck = handler),
    webRequest: {
      onHeadersReceived: (handler: Listener) => (this.headers = handler),
    },
  };
  send(...args: unknown[]) {
    this.sent.push(args);
  }
  getURL() {
    return this.url;
  }
  setWindowOpenHandler(handler: Listener) {
    this.openHandler = handler;
  }
  async printToPDF() {
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  }
  async getPrintersAsync() {
    return this.printers;
  }
  print(_options: unknown, done: (success: boolean, reason: string) => void) {
    done(...this.printResult);
  }
}

export class FakeWindow extends Emitter {
  static all: FakeWindow[] = [];
  webContents = new FakeContents();
  destroyed = false;
  closed = false;
  show = vi.fn();
  focus = vi.fn();
  setOpacity = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  showInactive = vi.fn();
  constructor(public options: Record<string, unknown>) {
    super();
    FakeWindow.all.push(this);
  }
  async loadURL(url: string) {
    this.webContents.loaded.push(url);
    this.webContents.url = url;
  }
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    this.closed = true;
    this.destroyed = true;
  }
}

function create() {
  let ready!: () => void;
  const whenReady = new Promise<void>((resolve) => (ready = resolve));
  const handlers = new Map<string, Listener>();
  const ipcListeners = new Map<string, Listener>();
  const app = Object.assign(new Emitter(), {
    isPackaged: false,
    paths: {} as Record<string, string>,
    setPath(name: string, path: string) {
      app.paths[name] = path;
    },
    getPath(name: string) {
      return app.paths[name] ?? `/fake/${name}`;
    },
    getVersion: () => "1.2.3",
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    exit: vi.fn(),
    whenReady: () => whenReady,
    dock: { hide: vi.fn() },
  });
  const menus: any[] = [];
  return {
    app,
    ready: () => ready(),
    handlers,
    ipcListeners,
    menus,
    electron: {
      app,
      BrowserWindow: FakeWindow,
      dialog: {
        showOpenDialog: vi.fn<
          (window?: unknown, options?: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>
        >(async () => ({ canceled: true, filePaths: [] })),
        showSaveDialog: vi.fn<
          (window?: unknown, options?: unknown) => Promise<{ canceled: boolean; filePath?: string }>
        >(async () => ({ canceled: true })),
        showMessageBoxSync: vi.fn<(window?: unknown, options?: unknown) => number>(() => 0),
      },
      ipcMain: {
        handle: (channel: string, handler: Listener) =>
          handlers.set(channel, handler),
        on: (channel: string, listener: Listener) =>
          ipcListeners.set(channel, listener),
      },
      Menu: {
        buildFromTemplate: (template: unknown) => template,
        setApplicationMenu: (menu: unknown) => menus.push(menu),
      },
      protocol: { registerSchemesAsPrivileged: vi.fn() },
      shell: { openExternal: vi.fn(async () => {}) },
    },
  };
}

export type FakeElectron = ReturnType<typeof create>;

/** One fake per test file, kept on globalThis so a module reset reuses it. */
export function fakeElectron(): FakeElectron {
  const holder = globalThis as { __suiteleafFakeElectron?: FakeElectron };
  return (holder.__suiteleafFakeElectron ??= create());
}

/** The `electron` module for vi.mock. It reads the current fake on each access. */
export function electronModule() {
  const module: Record<string, unknown> = {};
  for (const name of Object.keys(create().electron))
    Object.defineProperty(module, name, {
      enumerable: true,
      get: () =>
        (fakeElectron().electron as Record<string, unknown>)[name],
    });
  return module;
}

export function resetFakeElectron() {
  delete (globalThis as { __suiteleafFakeElectron?: FakeElectron })
    .__suiteleafFakeElectron;
  FakeWindow.all = [];
}

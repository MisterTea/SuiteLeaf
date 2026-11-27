import {
  kindFromName,
  parseFileBytes,
  type AppMode,
  type DesktopBridge,
  type DocumentScanProgress,
  type FileRecord,
  type GoogleDriveStatus,
} from "@suiteleaf/core";
import { createAndroidAiBridge } from "./android-ai-bridge";
import { AndroidFileStore } from "./android-store";
import { createAndroidUpdaterBridge } from "./android-updater";
import { GDRIVE_SCOPE, GoogleDriveApiClient } from "./gdrive-api";
import { GoogleDriveFsAdapter } from "./gdrive-fs-adapter";
import {
  getAndroidNativePlugin,
  getAndroidUpdaterNativePlugin,
  type AndroidUpdaterNativePlugin,
  type SuiteLeafAndroidNativePlugin,
} from "./native-plugin";

const MODE_KEY = "suiteleaf:android:mode";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createAndroidBridge(
  plugin: SuiteLeafAndroidNativePlugin,
  options?: {
    dbName?: string;
    fetchImpl?: typeof fetch;
    isOnline?: () => boolean;
    updaterPlugin?: AndroidUpdaterNativePlugin | null;
  },
): DesktopBridge {
  let cachedToken: string | null = null;
  const filesChangedListeners = new Set<() => void>();
  const scanListeners = new Set<(progress: DocumentScanProgress) => void>();
  const statusListeners = new Set<(status: GoogleDriveStatus) => void>();

  const api = new GoogleDriveApiClient({
    fetchImpl: options?.fetchImpl,
    getAccessToken: async (forceRefresh = false) => {
      if (cachedToken && !forceRefresh) return cachedToken;
      const auth = await plugin.authorizeGoogleDrive({
        forceRefresh,
        scope: GDRIVE_SCOPE,
      });
      cachedToken = auth.accessToken;
      return auth.accessToken;
    },
  });

  const fs = new GoogleDriveFsAdapter(api);
  const store = new AndroidFileStore({
    fs,
    dbName: options?.dbName,
    isOnline: options?.isOnline,
    onFilesChanged: () => filesChangedListeners.forEach((cb) => cb()),
    onScanProgress: (progress) => scanListeners.forEach((cb) => cb(progress)),
    onStatusChanged: (status) => statusListeners.forEach((cb) => cb(status)),
  });

  const triggerSync = () => {
    void store.syncNow().catch(() => {
      // Errors are surfaced via GoogleDriveStatus.error.
    });
  };

  const updaterNative = options?.updaterPlugin ?? getAndroidUpdaterNativePlugin();
  const updater = updaterNative ? createAndroidUpdaterBridge(updaterNative) : undefined;

  if (typeof window !== "undefined") {
    window.addEventListener("online", triggerSync);
    const poll = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        triggerSync();
      }
    }, 30_000);
    void plugin.addListener("appResumed", () => {
      triggerSync();
      void updater?.checkAutomatically();
    });
    void store.init().then(() => triggerSync());
    void poll;
  }

  const ai = createAndroidAiBridge(plugin);

  return {
    platform: "android",
    ai,
    updater,
    googleDrive: {
      status: () => store.getStatus(),
      async signIn(): Promise<GoogleDriveStatus> {
        const auth = await plugin.authorizeGoogleDrive({
          forceRefresh: true,
          scope: GDRIVE_SCOPE,
        });
        cachedToken = auth.accessToken;
        await store.setConnection(true, auth.email);
        await store.syncNow();
        return store.getStatus();
      },
      async signOut(): Promise<void> {
        cachedToken = null;
        await plugin.revokeGoogleDrive().catch(() => {});
        await store.setConnection(false);
      },
      onStatus(callback) {
        statusListeners.add(callback);
        return () => void statusListeners.delete(callback);
      },
    },
    getDocumentsDirectory: async () => store.getDocumentsDirectory(),
    rescanDocumentsDirectory: async () => {
      await store.syncNow();
    },
    onDocumentScan(callback) {
      scanListeners.add(callback);
      return () => void scanListeners.delete(callback);
    },
    onFilesChanged(callback) {
      filesChangedListeners.add(callback);
      return () => void filesChangedListeners.delete(callback);
    },
    list: () => store.list(),
    get: (id) => store.get(id),
    save: (record) => store.save(record),
    remove: (id) => store.remove(id),
    reload: (id) => store.reload(id),
    setTrashed: (ids, trashed) => store.setTrashed(ids, trashed),
    listFolders: () => store.listFolders(),
    createFolder: (parent, name) => store.createFolder(parent, name),
    renameFolder: (folder, name) => store.renameFolder(folder, name),
    moveFolder: (folder, parent) => store.moveFolder(folder, parent),
    trashFolder: (folder) => store.trashFolder(folder),
    moveFile: (id, folder) => store.moveFile(id, folder),
    async open(): Promise<FileRecord | null> {
      const picked = await plugin.openDocument();
      if (picked.canceled || !picked.base64 || !picked.name) return null;
      const bytes = base64ToBytes(picked.base64);
      const file = await parseFileBytes(bytes, kindFromName(picked.name));
      return store.save({ file });
    },
    async saveAs(record: FileRecord): Promise<FileRecord | null> {
      return store.saveAsCopy(record);
    },
    async exportFile(name: string, content: string | Uint8Array): Promise<string | null> {
      const bytes =
        typeof content === "string" ? new TextEncoder().encode(content) : content;
      const res = await plugin.exportDocument({
        name,
        mimeType: "application/octet-stream",
        base64: bytesToBase64(bytes),
      });
      return res.canceled ? null : (res.path ?? name);
    },
    async print(title?: string): Promise<void> {
      await plugin.printDocument({ title });
    },
    onMenu: () => () => {},
    setDirty: () => {},
    async getMode(): Promise<AppMode> {
      try {
        const raw = localStorage.getItem(MODE_KEY);
        if (raw) return JSON.parse(raw) as AppMode;
      } catch {
        // Fallback to single-node mode.
      }
      return { kind: "single" };
    },
    async setMode(mode: AppMode): Promise<void> {
      if (mode.kind === "single") localStorage.removeItem(MODE_KEY);
      else localStorage.setItem(MODE_KEY, JSON.stringify(mode));
      location.reload();
    },
  };
}

/** Attach `window.suiteleaf` when running inside the Capacitor Android app. */
export function initAndroidBridge(): boolean {
  if (typeof window === "undefined" || window.suiteleaf) return false;
  const plugin = getAndroidNativePlugin();
  if (!plugin) return false;
  window.suiteleaf = createAndroidBridge(plugin);
  return true;
}

export interface PluginListenerHandle {
  remove(): Promise<void>;
}

export interface GoogleDriveAuthResult {
  accessToken: string;
  email?: string;
}

export interface NativeOpenDocumentResult {
  canceled?: boolean;
  name?: string;
  mimeType?: string;
  base64?: string;
}

export interface NativeExportDocumentResult {
  canceled?: boolean;
  path?: string;
}

export interface NativeAiCoreStatus {
  state: "idle" | "loading" | "ready" | "error";
  featureStatus?: "AVAILABLE" | "DOWNLOADABLE" | "DOWNLOADING" | "UNAVAILABLE";
  progress?: number;
  message?: string;
  loadMs?: number;
}

export type NativeAiCoreEvent =
  | { id: string; type: "text"; text: string }
  | {
      id: string;
      type: "done";
      reason: "stop" | "length" | "aborted";
      promptTokens: number;
      cachedTokens: number;
      outputTokens: number;
      promptMs: number;
      generateMs: number;
    }
  | { id: string; type: "error"; message: string };

export interface SuiteLeafAndroidNativePlugin {
  authorizeGoogleDrive(options: { forceRefresh?: boolean; scope: string }): Promise<GoogleDriveAuthResult>;
  revokeGoogleDrive(): Promise<void>;
  openDocument(): Promise<NativeOpenDocumentResult>;
  exportDocument(options: { name: string; mimeType: string; base64: string }): Promise<NativeExportDocumentResult>;
  printDocument(options: { title?: string }): Promise<void>;
  aicoreStatus(): Promise<NativeAiCoreStatus>;
  aicoreLoad(): Promise<NativeAiCoreStatus>;
  aicoreGenerate(options: {
    id: string;
    prompt: string;
    maxTokens: number;
    temperature?: number;
    topK?: number;
  }): Promise<void>;
  aicoreAbort(options: { id: string }): Promise<void>;
  addListener(
    eventName: "aicoreEvent",
    listenerFunc: (event: NativeAiCoreEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "aicoreStatus",
    listenerFunc: (status: NativeAiCoreStatus) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "appResumed",
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;
}

export interface AndroidUpdaterNativePlugin {
  check(options?: { manual?: boolean; startup?: boolean }): Promise<{
    value?: { version: string; body?: string | null } | null;
  }>;
  install(): Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    SuiteLeafAndroid?: SuiteLeafAndroidNativePlugin;
    AndroidUpdater?: AndroidUpdaterNativePlugin;
  };
}

export function getAndroidNativePlugin(): SuiteLeafAndroidNativePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== "android") return null;
  return cap.Plugins?.SuiteLeafAndroid ?? null;
}

export function getAndroidUpdaterNativePlugin(): AndroidUpdaterNativePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== "android") return null;
  return cap.Plugins?.AndroidUpdater ?? null;
}

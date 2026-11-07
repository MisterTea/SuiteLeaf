export const CAST_SENDER_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

export type CastSession = {
  sendMessage(namespace: string, message: unknown): Promise<void>;
};
export type CastContext = {
  setOptions(options: { receiverApplicationId: string; autoJoinPolicy: string; resumeSavedSession: boolean }): void;
  requestSession(): Promise<void>;
  getCurrentSession(): CastSession | null;
  endCurrentSession(stopCasting: boolean): void;
  addEventListener(type: string, callback: () => void): void;
  removeEventListener(type: string, callback: () => void): void;
};
type CastWindow = Window & {
  __onGCastApiAvailable?: (available: boolean) => void;
  cast?: { framework: { CastContext: { getInstance(): CastContext }; CastContextEventType: { SESSION_STATE_CHANGED: string } } };
};

/** Check configuration before loading Google's optional SDK. */
export function castUnavailable(appId: string | undefined): string | null {
  if (window.suiteleaf) return "Open SuiteLeaf in Google Chrome to cast slides.";
  if (!window.isSecureContext) return "Casting requires a secure (HTTPS) connection.";
  if (!appId?.trim()) return "Casting is not configured for this SuiteLeaf installation.";
  return null;
}

let loading: Promise<void> | undefined;
export function loadCastSdk(): Promise<void> {
  if ((window as CastWindow).cast?.framework) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const host = window as CastWindow;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => finish(false), 15_000);
    const previous = host.__onGCastApiAvailable;
    const finish = (available: boolean) => {
      window.clearTimeout(timer);
      host.__onGCastApiAvailable = previous;
      script.onerror = null;
      if (available) resolve();
      else { script.remove(); reject(new Error("Casting is unavailable. Use Google Chrome with a Google Cast device on the same Wi-Fi network.")); }
    };
    host.__onGCastApiAvailable = (available) => { finish(available); previous?.(available); };
    script.src = CAST_SENDER_URL;
    script.async = true;
    script.onerror = () => finish(false);
    document.head.append(script);
  }).catch((error: unknown) => { loading = undefined; throw error; });
  return loading;
}

export function configureCast(appId: string) {
  const framework = (window as CastWindow).cast!.framework;
  const context = framework.CastContext.getInstance();
  context.setOptions({ receiverApplicationId: appId, autoJoinPolicy: "tab_and_origin_scoped", resumeSavedSession: false });
  return { context, event: framework.CastContextEventType.SESSION_STATE_CHANGED };
}

export function castCancelled(error: unknown): boolean {
  return error === "cancel" || (typeof error === "object" && error !== null && "code" in error && error.code === "cancel");
}

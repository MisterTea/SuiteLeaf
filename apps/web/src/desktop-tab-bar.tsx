import { useEffect, useLayoutEffect, useState, type MouseEvent } from "react";
import { Plus, X } from "lucide-react";
import type { DesktopTabState } from "@suiteleaf/core";

/** Command on macOS, Ctrl elsewhere. */
export function tabClickHint(): string | undefined {
  if (!window.suiteleaf?.tabs) return undefined;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return `${mac ? "Command" : "Ctrl"}-click to open in a new tab`;
}

/** Ctrl-click on macOS is the context-menu gesture, so it must not also open a tab. */
let contextMenuAt = 0;
export function noteContextMenu() {
  contextMenuAt = Date.now();
}

/** Open a document in another tab. The desktop app uses its own tab strip. */
export function openDocumentInNewTab(path: string, title?: string) {
  const tabs = window.suiteleaf?.tabs;
  if (tabs) {
    void tabs.open(path, title).catch(() => {});
    return;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = path;
  window.open(url.href, "_blank");
}

/** Open a document tab for a modified click. Leaves a normal click alone. */
export function onDocumentTabClick(
  event: { button?: number; metaKey: boolean; ctrlKey: boolean; preventDefault(): void },
  path: string,
  title?: string,
) {
  const tabs = window.suiteleaf?.tabs;
  if (!tabs) return;
  // A context menu was just opened with Ctrl-click. That click is not a new tab.
  if (event.ctrlKey && !event.metaKey && event.button !== 1 && Date.now() - contextMenuAt < 500) return;
  if (event.button !== 1 && !event.metaKey && !event.ctrlKey) return;
  event.preventDefault();
  openDocumentInNewTab(path, title);
}

/** Publish the open document's name to the desktop tab strip. */
export function useDesktopTabTitle(title: string | undefined) {
  useEffect(() => {
    if (!window.suiteleaf?.tabs) return;
    const name = (title ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    if (!name) return;
    document.title = name;
    return () => {
      document.title = "SuiteLeaf";
    };
  }, [title]);
}

/** The strip of open documents. Each extra document is a separate desktop page. */
export function DesktopTabBar() {
  const [tabs, setTabs] = useState<DesktopTabState[]>([]);
  useLayoutEffect(() => {
    if (!window.suiteleaf?.tabs) return;
    document.documentElement.classList.add("desktop-tabs");
    return () => document.documentElement.classList.remove("desktop-tabs");
  }, []);
  useEffect(() => {
    const api = window.suiteleaf?.tabs;
    if (!api) return;
    let alive = true;
    void api.list().then((list) => {
      if (alive) setTabs(list);
    });
    const stop = api.onChange((list) => setTabs(list));
    return () => {
      alive = false;
      stop();
    };
  }, []);
  if (!window.suiteleaf?.tabs || tabs.length === 0) return null;
  const choose = (id: string) => void window.suiteleaf?.tabs?.activate(id);
  const close = (event: MouseEvent, id: string) => {
    event.stopPropagation();
    void window.suiteleaf?.tabs?.close(id);
  };
  return (
    <div className="desktop-tab-bar">
      <div className="desktop-tab-list" role="tablist" aria-label="Open documents">
        {tabs.map((tab) => (
          <div key={tab.id} className={`desktop-tab${tab.active ? " active" : ""}`} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={tab.active}
              className="desktop-tab-label"
              title={tab.title}
              onClick={() => choose(tab.id)}
            >
              {tab.title}
            </button>
            <button
              type="button"
              className="desktop-tab-close"
              aria-label={`Close ${tab.title}`}
              title="Close tab"
              onClick={(event) => close(event, tab.id)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="desktop-tab-new"
        aria-label="New tab"
        title="New tab"
        onClick={() => void window.suiteleaf?.tabs?.open("/", "Files")}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

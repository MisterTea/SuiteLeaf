import type { IssueData, IssueResult } from "@suiteleaf/core";

/** Public Bugcatcher Worker (services/bugcatcher). Holds the GitHub token server-side. */
export const BUGCATCHER_URL: string =
  import.meta.env.VITE_BUGCATCHER_URL ?? "https://suiteleaf-bugcatcher.jgmath2000.workers.dev";

/** Renders the current browser viewport to a PNG data URL when native desktop capture is unavailable. */
export function captureDomCanvasScreenshot(): string {
  try {
    const width = Math.max(1, window.innerWidth || 1024);
    const height = Math.max(1, window.innerHeight || 768);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    ctx.fillStyle = window.getComputedStyle(document.body).backgroundColor || "#ffffff";
    ctx.fillRect(0, 0, width, height);

    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.display === "none" || rect.width <= 0 || rect.height <= 0) continue;
      if (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)") {
        ctx.fillStyle = style.backgroundColor;
        ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      }
      const text = el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE
        ? el.textContent?.trim()
        : "";
      if (text) {
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.fillStyle = style.color || "#1f1f1f";
        ctx.fillText(text, rect.left + 2, rect.top + 14, rect.width);
      }
    }
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.startsWith("data:image/png;base64,") ? dataUrl : "";
  } catch {
    return "";
  }
}

/** Captures a screenshot using DesktopBridge or browser canvas fallback. */
export async function captureCurrentScreenshot(): Promise<string> {
  if (typeof window !== "undefined" && window.suiteleaf?.captureScreenshot) {
    try {
      const dataUrl = await window.suiteleaf.captureScreenshot();
      if (dataUrl) return dataUrl;
    } catch (err) {
      console.warn("Desktop screenshot capture failed:", err);
    }
  }
  return captureDomCanvasScreenshot();
}

/** Sends the report to Bugcatcher, which files the GitHub issue. */
export async function submitFeedbackIssue(
  data: IssueData,
  fetchImpl: typeof fetch = fetch,
): Promise<IssueResult> {
  const text = data.text.trim();
  if (!text) return { success: false, error: "Please enter a description before submitting." };
  try {
    const res = await fetchImpl(`${BUGCATCHER_URL}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: data.type,
        text,
        screenshot: data.screenshotDataUrl || undefined,
        context: `${location.pathname} · ${navigator.userAgent}`,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; number?: number; error?: string };
    if (!res.ok || !body.success)
      return { success: false, error: body.error ?? `Report failed (HTTP ${res.status}).` };
    return { success: true, number: body.number };
  } catch {
    return { success: false, error: "Could not reach the report service. Check your connection and try again." };
  }
}

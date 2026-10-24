import DOMPurify from "dompurify";
import { Marp } from "@marp-team/marp-core";
import type { Presentation } from "@suiteleaf/core";
import beamUtCss from "./themes/beam_ut.css?raw";
import { extractMarpCharts } from "./slide-marp-charts";
import { MARP_COMPILED_HTML } from "./slide-marp-bundle";

function dataBlob(uri: string): Blob | null {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!match) return null;
  try {
    const bytes = match[2]
      ? Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(match[3]));
    return new Blob([bytes], { type: match[1] });
  } catch {
    return null;
  }
}
function assetText(uri: string, mime: string): string | null {
  if (!uri.startsWith(`data:${mime}`)) return null;
  const match = /^data:[^;,]+(?:;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!match) return null;
  try {
    return match[1]
      ? new TextDecoder().decode(
          Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)),
        )
      : decodeURIComponent(match[2]);
  } catch {
    return null;
  }
}
let scalingRuntime: string | undefined;
function trustedScalingRuntime() {
  if (scalingRuntime === undefined) {
    // Obtain engine-owned code from a render with no authored HTML.
    const html = new Marp({ html: false }).render("# Marp runtime").html;
    scalingRuntime = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .join("\n");
  }
  return scalingRuntime;
}

/** Preserve original slide HTML/CSS while keeping source-authored JavaScript inert. */
export function renderMarpPages(deck: Presentation) {
  if (!deck.marp || !deck.marpSource || deck.marpSourceDirty) return null;
  const urls = new Map<string, string>();
  const assets = Object.entries(deck.marpAssets ?? {}).sort(
    (a, b) => b[0].length - a[0].length,
  );
  const replaceAssets = (text: string) => {
    for (const [path, uri] of assets) {
      if (/^data:text\/(css|html)/.test(uri) || !text.includes(path)) continue;
      let url = urls.get(uri);
      if (!url) {
        const blob = dataBlob(uri);
        url =
          blob && typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(blob)
            : uri;
        urls.set(uri, url);
      }
      text = text.split(path).join(url);
    }
    return text;
  };
  const dispose = () => {
    for (const url of urls.values())
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  };
  try {
    const compiled = assetText(
      deck.marpAssets?.[MARP_COMPILED_HTML] ?? "",
      "text/html",
    );
    let html: string, css: string;
    if (compiled) {
      const doc = new DOMParser().parseFromString(
        replaceAssets(compiled),
        "text/html",
      );
      html = doc.body.innerHTML;
      css = [...doc.querySelectorAll("style")]
        .map((style) => style.textContent)
        .join("\n");
    } else {
      const engine = new Marp({ html: true, math: "katex" });
      engine.themeSet.add(beamUtCss);
      for (const [, uri] of assets) {
        const theme = assetText(uri, "text/css");
        if (theme) engine.themeSet.add(replaceAssets(theme));
      }
      ({ html, css } = engine.render(replaceAssets(deck.marpSource)));
    }
    css = css.replace(/<\/style/gi, "\\3c /style");
    const runtime = trustedScalingRuntime();
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' data: blob: https: http:; img-src data: blob: https: http:; font-src data: blob: https: http:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
    const mermaidTheme =
      /mermaid\.initialize\(\s*\{[^}]*theme\s*:\s*["'](forest|dark|neutral|base|default)["']/s.exec(
        deck.marpSource,
      )?.[1] || "default";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = [...doc.querySelectorAll<SVGElement>("svg[data-marpit-svg]")];
    if (!nodes.length) {
      dispose();
      return null;
    }
    const themedCharts = /chart-defaults\.js|CDLChart/.test(html);
    const pages = nodes.map((page, index) => {
      let chartData = "[]",
        chartError = "";
      try {
        chartData = JSON.stringify(
          extractMarpCharts(
            [...page.querySelectorAll("script")].map(
              (script) => script.textContent || "",
            ),
            themedCharts,
          ),
        ).replace(/</g, "\\u003c");
      } catch (error) {
        chartError = JSON.stringify(
          error instanceof Error ? error.message : String(error),
        ).replace(/</g, "\\u003c");
      }
      const viewBox = page.getAttribute("viewBox")?.split(/\s+/).map(Number);
      const width = viewBox?.[2] || 1280,
        height = viewBox?.[3] || 720;
      const container = page.parentElement?.cloneNode(false) as
        HTMLElement | undefined;
      const wrapper = container || doc.createElement("div");
      if (!container) wrapper.className = "marpit";
      wrapper.innerHTML =
        '<svg style="display:none"></svg>'.repeat(index) + page.outerHTML;
      const body = DOMPurify.sanitize(wrapper.outerHTML, {
        ADD_TAGS: ["foreignObject", "marp-pre", "marp-auto-scaling"],
        ADD_ATTR: ["is"],
        ALLOWED_URI_REGEXP:
          /^(?:(?:https?|mailto|tel|sms|cid|xmpp|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
        HTML_INTEGRATION_POINTS: {
          foreignobject: true,
          "annotation-xml": true,
        },
        CUSTOM_ELEMENT_HANDLING: {
          tagNameCheck: /^(marp-|mjx-)/,
          attributeNameCheck: /.*/,
          allowCustomizedBuiltInElements: true,
        },
      });
      return {
        width,
        height,
        document: `<!doctype html><html data-mermaid-theme="${mermaidTheme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${css}</style><style>html,body{margin:0;padding:0}svg[data-marpit-svg]{display:block;width:${width}px;height:${height}px}</style></head><body>${body}<script type="application/json" data-suiteleaf-charts>${chartData}</script><script type="application/json" data-suiteleaf-chart-error>${chartError}</script><script nonce="${nonce}" data-suiteleaf-runtime>${runtime}</script></body></html>`,
      };
    });
    return { pages, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

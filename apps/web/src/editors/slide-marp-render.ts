import DOMPurify from "dompurify";
import { Marp } from "@marp-team/marp-core";
import type { Presentation } from "@suiteleaf/core";
import { extractMarpCharts } from "./slide-marp-charts";
import { MARP_COMPILED_HTML } from "./slide-marp-bundle";
import { marpEngine, SOURCE_LINES } from "./slide-marp-engine";
import { marpProblem } from "./slide-marp-source";

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
/** One object URL per asset while any render holds it, so a redraw names the same pictures. */
const assetUrls = new Map<string, { url: string; holders: number }>();
export function holdAssetUrl(uri: string): string {
  const held = assetUrls.get(uri);
  if (held) {
    held.holders++;
    return held.url;
  }
  const blob = dataBlob(uri);
  const url =
    blob && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(blob)
      : uri;
  assetUrls.set(uri, { url, holders: 1 });
  return url;
}
export function releaseAssetUrl(uri: string) {
  const held = assetUrls.get(uri);
  if (!held || --held.holders > 0) return;
  assetUrls.delete(uri);
  if (held.url.startsWith("blob:")) URL.revokeObjectURL(held.url);
}

let scalingRuntime: string | undefined;
/** MARP's own scaling code, from a render with no authored HTML. */
export function trustedScalingRuntime() {
  if (scalingRuntime === undefined) {
    const html = new Marp({ html: false }).render("# Marp runtime").html;
    scalingRuntime = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .join("\n");
  }
  return scalingRuntime;
}

/** Authored HTML keeps its markup and styles; scripts and event handlers are removed. */
export function sanitizeMarpHtml(html: string): string {
  return DOMPurify.sanitize(html, {
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
}

/** Only scripts carrying this nonce run: MARP's scaling and the editor's diagram renderer. */
export function marpPolicy(nonce: string) {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' data: blob: https: http:; img-src data: blob: https: http:; font-src data: blob: https: http:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
}

function mermaidThemeOf(source: string) {
  return (
    /mermaid\.initialize\(\s*\{[^}]*theme\s*:\s*["'](forest|dark|neutral|base|default)["']/s.exec(
      source,
    )?.[1] || "default"
  );
}

/** Chart definitions read from authored scripts, which never run themselves. */
function chartPayload(scripts: { textContent: string | null }[], themed: boolean) {
  try {
    return {
      data: JSON.stringify(
        extractMarpCharts(
          scripts.map((script) => script.textContent || ""),
          themed,
        ),
      ).replace(/</g, "\\u003c"),
      error: "",
    };
  } catch (error) {
    return {
      data: "[]",
      error: JSON.stringify(error instanceof Error ? error.message : String(error)).replace(
        /</g,
        "\\u003c",
      ),
    };
  }
}

/**
 * A self-contained page for a sandboxed frame: sanitized slide HTML, its CSS,
 * chart data for the trusted renderer, and MARP's scaling code under a nonce.
 */
export function marpDocument(options: {
  html: string;
  css: string;
  source: string;
  width: number;
  height: number;
  scripts: { textContent: string | null }[];
  themedCharts: boolean;
}) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const css = options.css.replace(/<\/style/gi, "\\3c /style");
  const charts = chartPayload(options.scripts, options.themedCharts);
  return `<!doctype html><html data-mermaid-theme="${mermaidThemeOf(options.source)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${marpPolicy(nonce)}"><style>${css}</style><style>html,body{margin:0;padding:0}svg[data-marpit-svg]{display:block;width:${options.width}px;height:${options.height}px}</style></head><body>${sanitizeMarpHtml(options.html)}<script type="application/json" data-suiteleaf-charts>${charts.data}</script><script type="application/json" data-suiteleaf-chart-error>${charts.error}</script><script nonce="${nonce}" data-suiteleaf-runtime>${trustedScalingRuntime()}</script></body></html>`;
}

/**
 * One slide as MARP draws it. `document` carries source lines when the render
 * asked for them; `plain` never does. Each is built the first time it is read.
 */
export interface MarpPage {
  width: number;
  height: number;
  readonly document: string;
  readonly plain: string;
}
interface BuiltPage extends MarpPage {
  /** The page's markup, and its markup without source lines. */
  markup: string;
  plainMarkup: string;
  /** The plain document, if it has been built. */
  builtPlain: () => string | undefined;
}
export interface MarpPages {
  pages: MarpPage[];
  dispose: () => void;
}
interface BuiltPages extends MarpPages {
  pages: BuiltPage[];
  /** Everything outside a page's markup that its document depends on. */
  context: string;
}
const LINE_ATTRIBUTES = new RegExp(` ${SOURCE_LINES}="[^"]*"`, "g");

/**
 * Preserve original slide HTML/CSS while keeping source-authored JavaScript inert.
 * Given the `previous` render, a page whose markup did not change is the same
 * page object, and a page whose only change is its source lines keeps its
 * `plain` document, so frames showing them do not reload.
 */
export function renderMarpPages(
  deck: Presentation,
  options: { sourceLines?: boolean; previous?: MarpPages | null } = {},
): MarpPages | null {
  if (!deck.marp || !deck.marpSource || deck.marpSourceDirty) return null;
  if (marpProblem(deck.marpSource)) return null;
  const urls = new Map<string, string>();
  const assets = Object.entries(deck.marpAssets ?? {}).sort(
    (a, b) => b[0].length - a[0].length,
  );
  const replaceAssets = (text: string) => {
    for (const [path, uri] of assets) {
      if (/^data:text\/(css|html)/.test(uri) || !text.includes(path)) continue;
      let url = urls.get(uri);
      if (!url) {
        url = holdAssetUrl(uri);
        urls.set(uri, url);
      }
      text = text.split(path).join(url);
    }
    return text;
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const uri of urls.keys()) releaseAssetUrl(uri);
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
      const engine = marpEngine({ sourceLines: options.sourceLines });
      for (const [, uri] of assets) {
        const theme = assetText(uri, "text/css");
        if (theme) engine.themeSet.add(replaceAssets(theme));
      }
      ({ html, css } = engine.render(replaceAssets(deck.marpSource)));
    }
    const source = deck.marpSource;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = [...doc.querySelectorAll<SVGElement>("svg[data-marpit-svg]")];
    if (!nodes.length) {
      dispose();
      return null;
    }
    const themedCharts = /chart-defaults\.js|CDLChart/.test(html);
    const context = `${themedCharts}\n${mermaidThemeOf(source)}\n${css}`;
    const before = options.previous as BuiltPages | null | undefined;
    const earlier = before?.context === context ? before.pages : [];
    const pages = nodes.map((page, index): BuiltPage => {
      const viewBox = page.getAttribute("viewBox")?.split(/\s+/).map(Number);
      const width = viewBox?.[2] || 1280,
        height = viewBox?.[3] || 720;
      const container = page.parentElement?.cloneNode(false) as
        HTMLElement | undefined;
      const wrapper = container || doc.createElement("div");
      if (!container) wrapper.className = "marpit";
      const scripts = [...page.querySelectorAll("script")].map((script) => ({
        textContent: script.textContent,
      }));
      wrapper.innerHTML =
        '<svg style="display:none"></svg>'.repeat(index) + page.outerHTML;
      const markup = wrapper.outerHTML;
      const plainMarkup = options.sourceLines ? markup.replace(LINE_ATTRIBUTES, "") : markup;
      const old = earlier[index];
      if (old && old.markup === markup && old.width === width && old.height === height) return old;
      const build = (pageHtml: string) =>
        marpDocument({ html: pageHtml, css, source, width, height, scripts, themedCharts });
      let built: string | undefined;
      let plain =
        old && old.plainMarkup === plainMarkup && old.width === width && old.height === height
          ? old.builtPlain()
          : undefined;
      return {
        width,
        height,
        markup,
        plainMarkup,
        builtPlain: () => plain ?? (plainMarkup === markup ? built : undefined),
        get document() {
          return (built ??= build(markup));
        },
        get plain() {
          return (plain ??= plainMarkup === markup ? this.document : build(plainMarkup));
        },
      };
    });
    const built: BuiltPages = { pages, dispose, context };
    return built;
  } catch (error) {
    dispose();
    throw error;
  }
}

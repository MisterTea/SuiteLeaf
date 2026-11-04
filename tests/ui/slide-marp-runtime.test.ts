// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareMarpDocument } from "../../apps/web/src/editors/slide-marp-runtime";

const charts = vi.hoisted(() => ({ made: [] as { canvas: HTMLCanvasElement; config: Record<string, unknown> }[] }));
vi.mock("chart.js/auto", () => ({
  default: class {
    constructor(canvas: HTMLCanvasElement, config: Record<string, unknown>) {
      charts.made.push({ canvas, config });
    }
    update() {}
    destroy() {}
  },
}));

/** A slide page in its own frame, as the editor and print draw them. */
function page(body: string, head = "") {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const view = frame.contentWindow as unknown as typeof window;
  Object.assign(view.HTMLImageElement.prototype, { decode: decoded });
  view.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AA==";
  view.Element.prototype.getBoundingClientRect = function (this: Element) {
    return layout(this);
  };
  doc.head.innerHTML = head;
  doc.body.innerHTML = body;
  return doc;
}

let decoded = vi.fn(async () => undefined);
let layout: (node: Element) => DOMRect = () => ({ bottom: 0 }) as DOMRect;

beforeEach(() => {
  charts.made = [];
  decoded = vi.fn(async () => undefined);
  layout = () => ({ bottom: 0 }) as DOMRect;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("getting a MARP page ready to measure or print", () => {
  it("does the work once per page", async () => {
    const doc = page("<section><p>Hi</p><img src='data:image/png;base64,AA=='></section>");
    const first = prepareMarpDocument(doc);
    expect(prepareMarpDocument(doc)).toBe(first);
    await first;
    expect(decoded).toHaveBeenCalled();
  });

  it("draws diagrams with the trusted renderer in the page's theme", async () => {
    const doc = page(
      '<section><div class="mermaid">graph TD; A--&gt;B</div><pre><code class="language-mermaid">graph LR; C--&gt;D</code></pre><div class="mermaid"><svg></svg></div><div class="mermaid">  </div></section>',
      '<script data-suiteleaf-runtime nonce="abc"></script>',
    );
    doc.documentElement.dataset.mermaidTheme = "dark";
    const render = vi.fn(async (id: string, source: string) => ({
      svg: `<svg id="${id}"><text>${source}</text><script>bad()</script></svg>`,
    }));
    const initialize = vi.fn();
    const append = vi.spyOn(doc.head, "appendChild").mockImplementation((node) => {
      const script = node as HTMLScriptElement;
      expect(script.nonce).toBe("abc");
      Object.assign(doc.defaultView!, { mermaid: { initialize, render } });
      queueMicrotask(() => script.onload?.(new Event("load")));
      return node;
    });
    await prepareMarpDocument(doc);
    expect(append).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark", securityLevel: "strict" }));
    expect(doc.querySelector(".mermaid")!.innerHTML).toContain("<text>graph TD; A--&gt;B</text>");
    expect(doc.querySelector(".mermaid")!.innerHTML).not.toContain("<script");
    expect(doc.querySelector("pre")!.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the default diagram theme and reports a renderer that will not load", async () => {
    const doc = page('<div class="mermaid">graph TD; A</div>');
    doc.documentElement.dataset.mermaidTheme = "rainbow";
    vi.spyOn(doc.head, "appendChild").mockImplementation((node) => {
      queueMicrotask(() => (node as HTMLScriptElement).onerror?.(new Event("error")));
      return node;
    });
    await expect(prepareMarpDocument(doc)).rejects.toThrow("Could not load the diagram renderer.");
  });

  it("turns chart definitions into pictures and reports a chart that cannot be drawn", async () => {
    const doc = page(
      [
        '<section><div style="width:400px"><canvas id="c1" width="300" height="150" style="width:300px"></canvas></div>',
        '<canvas id="c2" width="200" height="100"></canvas></section>',
        `<script data-suiteleaf-charts type="application/json">${JSON.stringify([
          { target: "c1", themed: false, config: { type: "bar", data: { datasets: [] }, options: { plugins: { title: { text: "Sales" } } } } },
          { target: "c2", themed: false, config: { type: "line", data: { datasets: [] }, options: { responsive: false } } },
        ])}</script>`,
      ].join(""),
    );
    await prepareMarpDocument(doc);
    expect(charts.made.map((chart) => chart.config.options)).toEqual([
      { plugins: { title: { text: "Sales" } }, responsive: false, animation: false },
      { responsive: false, animation: false },
    ]);
    const pictures = [...doc.querySelectorAll("img")];
    expect(pictures.map((img) => img.alt)).toEqual(["Sales", "Chart"]);
    expect(pictures[0].src).toBe("data:image/png;base64,AA==");
    expect(pictures[0].style.width).toBe("300px");
    expect(doc.querySelector("canvas")).toBeNull();

    const missing = page(
      `<div id="c3"></div><script data-suiteleaf-charts>${JSON.stringify([{ target: "c3", themed: false, config: {} }])}</script>`,
    );
    await expect(prepareMarpDocument(missing)).rejects.toThrow("Chart canvas c3 is missing.");
    const broken = page(`<script data-suiteleaf-chart-error>${JSON.stringify("Line 3: bad chart")}</script>`);
    await expect(prepareMarpDocument(broken)).rejects.toThrow("Line 3: bad chart");
  });

  it("shrinks a table that runs past the bottom of its slide", async () => {
    const doc = page('<section style="padding-bottom:20px"><table style="font-size:40px"><tr><td>a</td></tr></table></section>');
    const table = doc.querySelector("table")!;
    layout = (node) =>
      ({ bottom: node.tagName === "SECTION" ? 720 : 400 + parseFloat((node as HTMLElement).style.fontSize) * 10 }) as DOMRect;
    await prepareMarpDocument(doc);
    const size = parseFloat(table.style.fontSize);
    expect(size).toBeLessThan(30);
    expect(400 + size * 10).toBeLessThanOrEqual(701);
    expect(400 + (size / 0.95) * 10).toBeGreaterThan(701);
  });
});

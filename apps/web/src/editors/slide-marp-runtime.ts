import DOMPurify from "dompurify";
import mermaidRuntimeUrl from "mermaid/dist/mermaid.min.js?url";
import type { ChartConfiguration } from "chart.js";
import type { ChartDefinition } from "./slide-marp-charts";
import { styledChartConfig } from "./slide-marp-chart-theme";

const prepared = new WeakMap<Document, Promise<void>>();
let diagramSerial = 0;

/** Trusted renderers handle declarative diagrams; source-authored scripts never run. */
export function prepareMarpDocument(doc: Document): Promise<void> {
  const existing = prepared.get(doc);
  if (existing) return existing;
  const work = (async () => {
    await doc.fonts?.ready;
    await Promise.all(
      [...doc.images].map((image) => image.decode().catch(() => {})),
    );
    const diagrams = [
      ...doc.querySelectorAll<HTMLElement>(".mermaid, code.language-mermaid"),
    ];
    if (diagrams.length) {
      await new Promise<void>((resolve, reject) => {
        const script = doc.createElement("script");
        script.src = mermaidRuntimeUrl;
        script.nonce =
          doc.querySelector<HTMLScriptElement>("script[data-suiteleaf-runtime]")
            ?.nonce || "";
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Could not load the diagram renderer."));
        doc.head.appendChild(script);
      });
      const mermaid = (
        doc.defaultView as unknown as {
          mermaid: typeof import("mermaid").default;
        }
      ).mermaid;
      const theme = doc.documentElement.dataset.mermaidTheme;
      const knownTheme =
        theme === "forest" ||
        theme === "dark" ||
        theme === "neutral" ||
        theme === "base"
          ? theme
          : "default";
      for (const node of diagrams) {
        if (node.querySelector("svg")) continue;
        const source = node.textContent?.trim();
        if (!source) continue;
        const host = node.matches("code") ? node.parentElement! : node;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: knownTheme,
          fontFamily: doc.defaultView?.getComputedStyle(host).fontFamily,
        });
        const { svg } = await mermaid.render(
          `suiteleaf-diagram-${++diagramSerial}`,
          source,
        );
        host.innerHTML = DOMPurify.sanitize(svg, {
          ADD_TAGS: ["foreignObject"],
          HTML_INTEGRATION_POINTS: { foreignobject: true },
        });
      }
    }
    const error = doc.querySelector(
      "script[data-suiteleaf-chart-error]",
    )?.textContent;
    if (error) throw new Error(JSON.parse(error));
    const definitions = JSON.parse(
      doc.querySelector("script[data-suiteleaf-charts]")?.textContent || "[]",
    ) as ChartDefinition[];
    if (definitions.length) {
      const { default: Chart } = await import("chart.js/auto");
      for (const definition of definitions) {
        const canvas = doc.getElementById(
          definition.target,
        ) as HTMLCanvasElement | null;
        if (!canvas || canvas.tagName !== "CANVAS")
          throw new Error(`Chart canvas ${definition.target} is missing.`);
        const config = styledChartConfig(definition, canvas);
        const options = config.options as { responsive?: boolean } | undefined;
        if (options?.responsive !== false && canvas.parentElement) {
          // Match Chart.js responsive layout before freezing it for PDF output.
          canvas.width = canvas.parentElement.clientWidth || canvas.width;
          canvas.height = canvas.parentElement.clientHeight || canvas.height;
        }
        config.options = {
          ...(config.options as object),
          responsive: false,
          animation: false,
        };
        const chart = new Chart(
          canvas,
          config as unknown as ChartConfiguration,
        );
        chart.update("none");
        const image = doc.createElement("img");
        image.src = canvas.toDataURL("image/png");
        image.style.cssText = canvas.style.cssText;
        image.width = canvas.width;
        image.height = canvas.height;
        image.alt = String(
          (
            definition.config.options as {
              plugins?: { title?: { text?: string } };
            }
          )?.plugins?.title?.text || "Chart",
        );
        chart.destroy();
        canvas.replaceWith(image);
        await image.decode();
      }
    }
    await doc.fonts?.ready;
    for (const table of doc.querySelectorAll<HTMLTableElement>(
      "section table",
    )) {
      const section = table.closest("section")!;
      const style = doc.defaultView!.getComputedStyle(section);
      const bottom =
        section.getBoundingClientRect().bottom -
        parseFloat(style.paddingBottom || "0");
      let size = parseFloat(doc.defaultView!.getComputedStyle(table).fontSize);
      // Fit overflowing source tables without running source-authored layout scripts.
      for (
        let attempt = 0;
        attempt < 40 && table.getBoundingClientRect().bottom > bottom + 1;
        attempt++
      ) {
        size *= 0.95;
        table.style.fontSize = `${size}px`;
      }
    }
  })();
  prepared.set(doc, work);
  return work;
}

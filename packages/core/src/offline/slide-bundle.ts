import JSZip from "jszip";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { SlideFile } from "../file-schema";
import { serializeFile } from "../native-file";

export interface BundleManifestEntry {
  path: string;
  size: number;
  sha256: string;
  type: "document" | "viewer" | "media" | "font" | "license";
}

export interface BundleManifest {
  version: "1.0";
  title: string;
  fileId: string;
  createdAt: string;
  viewerEntry: string;
  contents: BundleManifestEntry[];
  offlineSelfContained: boolean;
  licensingNotice: string;
}

export interface BundleOptions {
  includeViewer?: boolean;
  licensingNote?: string;
}

const DEFAULT_LICENSE_NOTICE = `SUITELEAF PORTABLE SLIDE BUNDLE - LICENSING & COMPLIANCE

1. Presentation Viewer & Runtime
   The embedded viewer runtime is provided under the SuiteLeaf Application License.
   This bundle is designed to operate completely offline without external network dependencies.

2. Typography & Fonts
   Any fonts embedded in this bundle are open-source fonts (SIL Open Font License or Apache 2.0).
   SuiteLeaf provides layout-identical metrics to standard Microsoft Office fonts
   (e.g., SuiteLeaf Willow <-> Calibri) to ensure pixel and layout fidelity without redistributing
   proprietary third-party fonts.

3. User Media & Content
   All images, drawings, tables, text, and media embedded in this presentation remain the intellectual
   property of their respective copyright holders.
`;

/**
 * Generate a standalone, network-isolated HTML viewer for the presentation deck.
 * Uses inline CSS and SVG layout so no external CSS or JavaScript CDNs are queried.
 */
function generateOfflineViewerHtml(file: SlideFile): string {
  const slides = (file.content?.slideOrder ?? []).map((id, index) => {
    const s = file.content?.slides[id];
    return {
      index: index + 1,
      title: s?.title ?? `Slide ${index + 1}`,
      notes: s?.notes ?? "",
      elements: s?.elements ?? [],
    };
  });

  const payload = JSON.stringify(slides).replaceAll("<", "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(file.title || "Presentation")} - Portable Viewer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    header { background: #1e293b; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
    header h1 { font-size: 16px; font-weight: 600; }
    .badge { background: #059669; color: #fff; font-size: 11px; padding: 3px 8px; border-radius: 9999px; font-weight: 500; }
    main { flex: 1; display: flex; justify-content: center; align-items: center; padding: 24px; position: relative; }
    #slide-stage { width: 960px; height: 540px; background: #ffffff; color: #000000; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); position: relative; overflow: hidden; border-radius: 4px; }
    .slide-element { position: absolute; }
    footer { background: #1e293b; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #334155; font-size: 13px; }
    .btn { background: #3b82f6; color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-weight: 500; }
    .btn:hover { background: #2563eb; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #notes-box { font-size: 12px; color: #94a3b8; max-width: 500px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(file.title || "Presentation")}</h1>
    <span class="badge">Verified Offline Bundle</span>
  </header>
  <main>
    <div id="slide-stage"></div>
  </main>
  <footer>
    <button id="prev-btn" class="btn">Previous</button>
    <span id="page-indicator">Slide 1 of ${slides.length || 1}</span>
    <span id="notes-box"></span>
    <button id="next-btn" class="btn">Next</button>
  </footer>
  <script>
    const deck = ${payload};
    let current = 0;
    function render() {
      const stage = document.getElementById("slide-stage");
      const page = document.getElementById("page-indicator");
      const notes = document.getElementById("notes-box");
      const prev = document.getElementById("prev-btn");
      const next = document.getElementById("next-btn");
      if (!deck.length) return;
      const s = deck[current];
      page.textContent = "Slide " + (current + 1) + " of " + deck.length;
      notes.textContent = s.notes ? "Notes: " + s.notes : "";
      prev.disabled = current === 0;
      next.disabled = current === deck.length - 1;
      stage.innerHTML = "";
      for (const el of s.elements) {
        const div = document.createElement("div");
        div.className = "slide-element";
        div.style.left = el.x + "px";
        div.style.top = el.y + "px";
        div.style.width = el.width + "px";
        div.style.height = el.height + "px";
        if (el.rotation) div.style.transform = "rotate(" + el.rotation + "deg)";
        if (el.type === "text") {
          div.style.fontSize = (el.fontSize || 16) + "px";
          div.style.fontFamily = el.fontFamily || "Arial, sans-serif";
          if (el.bold) div.style.fontWeight = "bold";
          div.textContent = el.content || (el.runs ? el.runs.map(r => r.text).join("") : "");
        } else if (el.type === "image") {
          const img = document.createElement("img");
          img.src = el.src;
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "contain";
          div.appendChild(img);
        } else if (el.type === "shape") {
          div.style.background = el.fill || "#cbd5e1";
          if (el.shapeType === "roundRect") div.style.borderRadius = "8px";
          else if (el.shapeType === "ellipse") div.style.borderRadius = "50%";
        } else if (el.type === "table" && el.rows) {
          const tbl = document.createElement("table");
          tbl.style.width = "100%";
          tbl.style.height = "100%";
          tbl.style.borderCollapse = "collapse";
          for (const row of el.rows) {
            const tr = document.createElement("tr");
            for (const cell of row) {
              const td = document.createElement("td");
              td.style.border = "1px solid #94a3b8";
              td.style.padding = "4px";
              td.textContent = cell;
              tr.appendChild(td);
            }
            tbl.appendChild(tr);
          }
          div.appendChild(tbl);
        }
        stage.appendChild(div);
      }
    }
    document.getElementById("prev-btn").onclick = () => { if (current > 0) { current--; render(); } };
    document.getElementById("next-btn").onclick = () => { if (current < deck.length - 1) { current++; render(); } };
    window.onkeydown = (e) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { if (current < deck.length - 1) { current++; render(); } }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { if (current > 0) { current--; render(); } }
    };
    render();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Create a portable slide bundle package (.slbundle / .zip).
 */
export async function createPortableSlideBundle(
  file: SlideFile,
  options: BundleOptions = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  const contents: BundleManifestEntry[] = [];

  // 1. Deck JSON
  const deckRaw = serializeFile(file);
  const deckBytes = new TextEncoder().encode(deckRaw);
  zip.file("deck.json", deckBytes);
  contents.push({
    path: "deck.json",
    size: deckBytes.byteLength,
    sha256: bytesToHex(sha256(deckBytes)),
    type: "document",
  });

  // 2. Standalone Offline Viewer
  if (options.includeViewer !== false) {
    const viewerHtml = generateOfflineViewerHtml(file);
    const viewerBytes = new TextEncoder().encode(viewerHtml);
    zip.file("index.html", viewerBytes);
    contents.push({
      path: "index.html",
      size: viewerBytes.byteLength,
      sha256: bytesToHex(sha256(viewerBytes)),
      type: "viewer",
    });
  }

  // 3. Licensing Notices
  const licenseText = options.licensingNote
    ? `${options.licensingNote}\n\n${DEFAULT_LICENSE_NOTICE}`
    : DEFAULT_LICENSE_NOTICE;
  const licenseBytes = new TextEncoder().encode(licenseText);
  zip.file("LICENSE_NOTICES.txt", licenseBytes);
  contents.push({
    path: "LICENSE_NOTICES.txt",
    size: licenseBytes.byteLength,
    sha256: bytesToHex(sha256(licenseBytes)),
    type: "license",
  });

  // 4. Manifest
  const manifest: BundleManifest = {
    version: "1.0",
    title: file.title || "Presentation Deck",
    fileId: file.id,
    createdAt: new Date().toISOString(),
    viewerEntry: "index.html",
    contents,
    offlineSelfContained: true,
    licensingNotice: "Included in LICENSE_NOTICES.txt",
  };

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  zip.file("manifest.json", manifestBytes);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export interface VerificationResult {
  valid: boolean;
  manifest: BundleManifest;
  verifiedFiles: string[];
  networkIsolated: boolean;
  errors: string[];
}

/**
 * Verify integrity and offline network-isolation of a portable slide bundle.
 */
export async function verifyPortableSlideBundle(
  bundleBytes: Uint8Array,
): Promise<VerificationResult> {
  const errors: string[] = [];
  const verifiedFiles: string[] = [];

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bundleBytes);
  } catch (err) {
    return {
      valid: false,
      manifest: null as any,
      verifiedFiles: [],
      networkIsolated: false,
      errors: [`Invalid ZIP archive: ${String(err)}`],
    };
  }

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    return {
      valid: false,
      manifest: null as any,
      verifiedFiles: [],
      networkIsolated: false,
      errors: ["Missing manifest.json in bundle"],
    };
  }

  const manifestText = await manifestFile.async("string");
  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return {
      valid: false,
      manifest: null as any,
      verifiedFiles: [],
      networkIsolated: false,
      errors: ["Invalid JSON in manifest.json"],
    };
  }

  // Check file hashes against manifest
  for (const entry of manifest.contents) {
    const file = zip.file(entry.path);
    if (!file) {
      errors.push(`Manifest declared file '${entry.path}' not found in archive.`);
      continue;
    }
    const data = await file.async("uint8array");
    const actualHash = bytesToHex(sha256(data));
    if (actualHash !== entry.sha256) {
      errors.push(
        `Integrity mismatch for '${entry.path}': expected ${entry.sha256}, got ${actualHash}`,
      );
    } else {
      verifiedFiles.push(entry.path);
    }
  }

  // Check network isolation in viewer HTML
  let networkIsolated = true;
  const viewerFile = zip.file("index.html");
  if (viewerFile) {
    const html = await viewerFile.async("string");
    // Ensure no external http/https resource tags or script loaders
    if (/<script[^>]+src=["']https?:/i.test(html) || /<link[^>]+href=["']https?:/i.test(html)) {
      networkIsolated = false;
      errors.push("Viewer contains external network resource requests (violates offline isolation)");
    }
  }

  return {
    valid: errors.length === 0,
    manifest,
    verifiedFiles,
    networkIsolated,
    errors,
  };
}

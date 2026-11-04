import { useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import type { ImportAssets } from "../imports";
import { listRelativeFiles, normalizeFolderFiles } from "../editors/slide-marp-import";
import { loadMarpBundle, missingMarpTheme } from "../editors/slide-marp-bundle";

export function MarpPicturesDialog({
  markdown,
  name,
  paths,
  onDone,
}: {
  markdown: string;
  name: string;
  paths: string[];
  onDone: (choice: ImportAssets | "skip" | "cancel") => void;
}) {
  const folderInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingAssets = useRef<Record<string, string>>({});
  const accept = async (listed: { relativePath: string; file: File }[], stripRoot = false) => {
    setError("");
    try {
      const normalized = stripRoot ? normalizeFolderFiles(listed).files : listed;
      const matches = normalized.filter((item) => item.relativePath.split("/").pop() === name);
      let path = matches.length === 1 ? matches[0].relativePath : name;
      if (matches.length > 1) {
        const sameSource = await Promise.all(matches.map(async (item) => ({ item, same: await item.file.text() === markdown })));
        const exact = sameSource.filter((match) => match.same);
        if (exact.length !== 1) throw new Error("That folder contains more than one copy of this deck. Choose the folder containing the intended markdown file.");
        path = exact[0].item.relativePath;
      }
      const assets = { ...pendingAssets.current, ...await loadMarpBundle(path, markdown, normalized) };
      pendingAssets.current = assets;
      const missing = missingMarpTheme(markdown, assets);
      if (missing) throw new Error(`The ${missing} theme was not in that selection. Choose the folder containing its CSS file. Pictures already selected are retained.`);
      if (!Object.keys(assets).length) throw new Error("None of those assets were in that folder. Choose a folder containing the markdown and its themes or pictures.");
      onDone(assets);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not read that folder.");
    }
  };
  const choose = async () => {
    setError("");
    const show = (window as unknown as { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker;
    if (!show) {
      folderInput.current?.click();
      return;
    }
    setBusy(true);
    try {
      await accept(await listRelativeFiles(await show() as Parameters<typeof listRelativeFiles>[0]));
    } catch (e) {
      setBusy(false);
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Could not read that folder.");
    }
  };
  return (
    <div className="modal-overlay" onClick={() => onDone("cancel")}>
      <section
        className="gdocs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="marp-pictures-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onDone("cancel")}
      >
        <div className="dialog-header">
          <h2 id="marp-pictures-title">Include pictures</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Cancel import"
            onClick={() => onDone("cancel")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <p className="dialog-note">
            {name} uses {paths.length} file{paths.length === 1 ? "" : "s"} stored next to the
            markdown, such as {paths[0]}. Choose the folder that contains the markdown file so
            the pictures, fonts, and themes are included.
          </p>
          {error ? (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={() => onDone("skip")}>
            Import without pictures
          </button>
          <button type="button" className="dialog-primary-btn" disabled={busy} onClick={() => void choose()}>
            <FolderOpen size={16} /> {busy ? "Reading…" : "Choose folder"}
          </button>
        </div>
        <input
          hidden
          type="file"
          ref={folderInput}
          multiple
          {...{ webkitdirectory: "" }}
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = "";
            if (!list.length) return;
            setBusy(true);
            void accept(list.map((file) => ({ relativePath: file.webkitRelativePath || file.name, file })), true);
          }}
        />
      </section>
    </div>
  );
}

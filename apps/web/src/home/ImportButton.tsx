import { useEffect, useRef, useState, type RefObject } from "react";
import { FolderOpen, Upload, X } from "lucide-react";
import type { FileRecord, SuiteFile } from "@suiteleaf/core";
import { storage } from "../storage";
import {
  importFile,
  opensImportedFile,
  type DelimitedDraft,
  type ImportAssets,
} from "../imports";
import {
  hasMarpHeader,
  markdownInFolder,
  normalizeFolderFiles,
  officeImportTargets,
  preferredMarkdown,
} from "../editors/slide-marp-import";
import { loadMarpBundle, marpBundlePaths } from "../editors/slide-marp-bundle";
import { CsvImportDialog } from "../csv-import";
import type { DelimitedOptions } from "../csv";
import { message } from "../error-message";
import { MarpPicturesDialog } from "./MarpPicturesDialog";

type ProgressCallback = (completed: number, total: number) => void;
type FolderFiles = { relativePath: string; file: File }[];
async function planFolder(raw: FolderFiles, folderName = "") {
  const normalized = folderName ? { folderName, files: raw } : normalizeFolderFiles(raw);
  const marpChoices: string[] = [];
  for (const path of markdownInFolder(normalized.files)) {
    const item = normalized.files.find((file) => file.relativePath === path);
    if (item && hasMarpHeader(await item.file.text())) marpChoices.push(path);
  }
  const office = officeImportTargets(raw);
  return { normalized, marpChoices, office, count: marpChoices.length ? 1 : office.length };
}

export function ImportButton({
  onImport,
  onError,
  filePicker = false,
  uploading = false,
  importer,
  dropImporter,
  openDroppedFile = true,
  placeInFolder,
  keepImported,
  onBatchDone,
}: {
  /** `name` is the chosen file's name when it came from the file picker. */
  onImport: (r: FileRecord, name?: string, onProgress?: ProgressCallback) => Promise<void>;
  onError: (s: string) => void;
  /** Always use the browser file picker, even on desktop. */
  filePicker?: boolean;
  /** Whether saving imports uploads them to SuiteDrive. */
  uploading?: boolean;
  /** Receives a function that imports a chosen file the same way the picker does. */
  importer?: RefObject<((f: File) => Promise<void>) | null>;
  /** Drive-page drops keep single files in the current folder. */
  openDroppedFile?: boolean;
  dropImporter?: RefObject<((data: DataTransfer) => Promise<void>) | null>;
  /**
   * Save one converted Office file into `folder`, a path relative to the
   * library folder that is open. The path includes the folder that was dropped.
   */
  placeInFolder?: (file: SuiteFile, folder: string, onProgress?: ProgressCallback) => Promise<FileRecord | void>;
  /** Save one file from a batch without leaving the current page. */
  keepImported?: (file: SuiteFile, onProgress?: ProgressCallback) => Promise<void>;
  /** Called after a batch import that stayed on this page. */
  onBatchDone?: () => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const stopImport = useRef(false);
  const [progress, setProgress] = useState<{ completed: number; total: number | null; name: string } | null>(null);
  const [conversion, setConversion] = useState<number | null>(null);
  const [upload, setUpload] = useState(0);
  const [conversionStage, setConversionStage] = useState("Starting…");
  const converting: ProgressCallback = (completed, total) => {
    if (total > 0) setConversion(Math.min(99, Math.floor(completed / total * 100)));
  };
  const uploaded: ProgressCallback = (accepted, total) => {
    setUpload(total > 0 ? Math.min(100, Math.max(0, Math.floor(accepted / total * 100))) : 100);
  };
  const converted = () => setConversion(100);
  const begin = (name: string) => {
    if (stopImport.current) throw new Error("Import cancelled. The original file is unchanged.");
    setConversion(null);
    setConversionStage("Starting…");
    setUpload(0);
    setProgress((current) => current && { ...current, name });
  };
  const advance = () => setProgress((current) => current && { ...current, completed: current.completed + 1 });
  const [deckChoice, setDeckChoice] = useState<{
    choices: string[];
    resolve: (path: string | null) => void;
  } | null>(null);
  const [review, setReview] = useState<{
    draft: DelimitedDraft;
    resolve: (options: DelimitedOptions | null) => void;
  } | null>(null);
  const [pictures, setPictures] = useState<{
    markdown: string;
    name: string;
    paths: string[];
    resolve: (choice: ImportAssets | "skip" | "cancel") => void;
  } | null>(null);
  const importOne = async (f: File, open: boolean) => {
    begin(f.name);
    const ext = f.name.split(".").pop()?.toLowerCase();
    let assets: ImportAssets | undefined;
    if (ext === "md" || ext === "markdown") {
      const markdown = await f.text();
      const paths = marpBundlePaths(markdown);
      if (paths.length) {
        const choice = await new Promise<ImportAssets | "skip" | "cancel">(
          (resolve) => setPictures({ markdown, name: f.name, paths, resolve }),
        );
        setPictures(null);
        if (choice === "cancel") return;
        if (choice !== "skip") assets = choice;
      }
    }
    const file = await importFile(
      f,
      (draft) => new Promise((resolve) => setReview({ draft, resolve })),
      assets,
      { shouldStop: () => stopImport.current, onProgress: converting, onStage: (stage) => setConversionStage(stage === "loading" ? "Loading converter…" : "Converting…") },
    );
    if (!file) { advance(); return; }
    converted();
    if (open) await onImport({ file }, f.name, uploaded);
    else if (keepImported) await keepImported(file, uploaded);
    else await onImport({ file }, f.name, uploaded);
    advance();
  };
  const importChosen = async (f: File) => {
    stopImport.current = false;
    setImporting(true);
    setProgress({ completed: 0, total: 1, name: f.name });
    try {
      await importOne(f, true);
    } catch (e) {
      onError(message(e));
    } finally {
      setImporting(false);
    }
  };
  if (importer) importer.current = importChosen;
  const importFolder = async (
    raw: { relativePath: string; file: File }[],
    folderName = "",
    openSingle = true,
    prepared?: Awaited<ReturnType<typeof planFolder>>,
  ) => {
    const { normalized, marpChoices, office } = prepared ?? await planFolder(raw, folderName);
    if (!marpChoices.length) {
      if (!office.length) throw new Error("That folder has no markdown file.");
      for (const item of office) {
        if (stopImport.current)
          throw new Error("Import cancelled. The original file is unchanged.");
        begin(item.file.relativePath);
        const file = await importFile(
          item.file.file,
          (draft) => new Promise((resolve) => setReview({ draft, resolve })),
          undefined,
          { shouldStop: () => stopImport.current, onProgress: converting, onStage: (stage) => setConversionStage(stage === "loading" ? "Loading converter…" : "Converting…") },
        );
        if (!file) { advance(); continue; }
        converted();
        const open = opensImportedFile(office.length) && openSingle;
        if (placeInFolder) {
          const placed = await placeInFolder(file, item.folder, uploaded);
          if (open) await onImport(placed ?? { file }, item.file.file.name, uploaded);
        } else if (open || !keepImported) await onImport({ file }, item.file.file.name, uploaded);
        else await keepImported(file, uploaded);
        advance();
      }
      return opensImportedFile(office.length) && openSingle;
    }
    let markdownPath = preferredMarkdown(marpChoices, folderName || normalized.folderName);
    if (!markdownPath) {
      markdownPath = await new Promise<string | null>((resolve) =>
        setDeckChoice({ choices: marpChoices, resolve }),
      );
      setDeckChoice(null);
      if (!markdownPath) return false;
    }
    const markdown = normalized.files.find((item) => item.relativePath === markdownPath);
    if (!markdown) throw new Error("That folder has no markdown file.");
    begin(markdown.relativePath);
    const text = await markdown.file.text();
    const assets = await loadMarpBundle(markdownPath, text, normalized.files);
    const file = await importFile(
      markdown.file,
      (draft) => new Promise((resolve) => setReview({ draft, resolve })),
      assets,
      { shouldStop: () => stopImport.current, onProgress: converting, onStage: (stage) => setConversionStage(stage === "loading" ? "Loading converter…" : "Converting…") },
    );
    if (!file) { advance(); return false; }
    converted();
    if (openSingle) await onImport({ file }, markdown.file.name, uploaded);
    else if (keepImported) await keepImported(file, uploaded);
    else await onImport({ file }, markdown.file.name, uploaded);
    advance();
    return openSingle || !keepImported;
  };
  const openFolder = () => {
    setMenu(false);
    // The directory input reports each file's path inside the folder. The
    // separate directory picker was cancelled as soon as the page updated.
    folderInput.current?.click();
  };
  const droppedEntries = async (entry: FileSystemEntry, prefix = ""): Promise<
    { relativePath: string; file: File }[]
  > => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      return [{ relativePath: prefix ? `${prefix}/${file.name}` : file.name, file }];
    }
    if (!entry.isDirectory) return [];
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      const all: FileSystemEntry[] = [];
      const read = () =>
        reader.readEntries((batch) => {
          if (!batch.length) resolve(all);
          else {
            all.push(...batch);
            read();
          }
        }, reject);
      read();
    });
    const next = prefix ? `${prefix}/${entry.name}` : entry.name;
    const nested: { relativePath: string; file: File }[] = [];
    for (const child of children) nested.push(...(await droppedEntries(child, next)));
    return nested;
  };
  const importDrop = async (data: DataTransfer) => {
    if (importing) return;
    setDropOver(false);
    setMenu(false);
    const entries = [...data.items]
      .map((item) => item.webkitGetAsEntry?.() ?? null)
      .filter((entry): entry is FileSystemEntry => !!entry);
    stopImport.current = false;
    setImporting(true);
    setProgress({ completed: 0, total: null, name: "" });
    let opened = false;
    try {
      const loose: File[] = [];
      const folders: { relativePath: string; file: File }[][] = [];
      if (entries.length) {
        for (const entry of entries) {
          if (entry.isDirectory) folders.push(await droppedEntries(entry));
          else {
            const [picked] = await droppedEntries(entry);
            if (picked) loose.push(picked.file);
          }
        }
      } else loose.push(...data.files);
      const plans = [];
      for (const folder of folders) plans.push(await planFolder(folder));
      setProgress({ completed: 0, total: loose.length + plans.reduce((sum, plan) => sum + plan.count, 0), name: "" });
      const open = openDroppedFile && opensImportedFile(loose.length + folders.length);
      for (const file of loose) {
        await importOne(file, open);
        if (open) opened = true;
      }
      for (let i = 0; i < folders.length; i++) {
        if (await importFolder(folders[i], "", open, plans[i])) opened = true;
      }
    } catch (err) {
      onError(message(err));
    } finally {
      try {
        if (!opened) await onBatchDone?.();
      } finally {
        setImporting(false);
      }
    }
  };
  if (dropImporter) dropImporter.current = importDrop;

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const open = async () => {
    setMenu(false);
    setImporting(true);
    try {
      if (window.suiteleaf && !filePicker) {
        setProgress({ completed: 0, total: null, name: "" });
        const r = await storage.open();
        if (r) await onImport(r);
      } else input.current?.click();
    } catch (e) {
      onError(message(e));
    } finally {
      setImporting(false);
    }
  };
  return (
    <>
      <div className="import-menu" ref={menuRef}>
        <button
          type="button"
          disabled={importing}
          aria-expanded={menu || importing}
          aria-haspopup="dialog"
          onClick={() => setMenu((open) => !open)}
        >
          <Upload size={16} />
          {importing ? "Importing…" : "Import"}
        </button>
        {importing && progress ? (
          <div className="import-popover import-progress" role="dialog" aria-label="Import progress">
            <strong>Importing files</strong>
            <p className="import-progress-name" title={progress.name}>
              {progress.name || "Reading files…"}
            </p>
            {progress.name ? (
              <>
                <p>Convert: {conversion === null ? conversionStage : `${conversion}%`}</p>
                <progress aria-label="Conversion progress" max={100} value={conversion ?? undefined} />
                {uploading ? (
                  <>
                    <p>Upload: {conversion !== 100 ? "Waiting for conversion" : `${upload}%`}</p>
                    <progress aria-label="Upload progress" max={100} value={upload} />
                  </>
                ) : null}
              </>
            ) : null}
            <progress aria-label="Files processed" max={progress.total || 1}
              value={progress.total === null ? undefined : progress.completed} />
            <p role="status">{progress.total === null ? "Preparing import…" : `${progress.completed} of ${progress.total} files processed`}</p>
            <button type="button" onClick={() => { stopImport.current = true; }}>Cancel import</button>
          </div>
        ) : null}
        {menu ? (
          <div className="import-popover" role="dialog" aria-label="Import">
            <div
              className={`import-drop${dropOver ? " over" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDropOver(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDropOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                void importDrop(event.dataTransfer);
              }}
            >
              Drop a file or folder
            </div>
            <div className="import-popover-actions">
              <button type="button" disabled={importing} onClick={() => void open()}>
                <Upload size={16} /> Open / import
              </button>
              <button type="button" disabled={importing} onClick={openFolder}>
                <FolderOpen size={16} /> Open folder
              </button>
              {window.suiteleaf && !filePicker ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    input.current?.click();
                  }}
                >
                  Import Office / HTML / CSV
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <input
        hidden
        type="file"
        ref={input}
        multiple
        accept=".sldoc,.slsheet,.slslides,.sldraw,.suiteleaf,.svg,.mmd,.mermaid,.gv,.docx,.docm,.dotx,.dotm,.doc,.dot,.xlsx,.xlsm,.xlsb,.xltx,.xls,.pptx,.ppt,.ppsx,.pptm,.potx,.ppsm,.odt,.ott,.fodt,.ods,.fods,.odp,.fodp,.rtf,.md,.markdown,.html,.htm,.txt,.csv,.tsv"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          if (opensImportedFile(files.length)) {
            await importChosen(files[0]);
            return;
          }
          stopImport.current = false;
          setImporting(true);
          setProgress({ completed: 0, total: files.length, name: "" });
          try {
            for (const file of files) await importOne(file, false);
            await onBatchDone?.();
          } catch (err) {
            onError(message(err));
          } finally {
            setImporting(false);
          }
        }}
      />
      <input
        className="import-folder-input"
        type="file"
        ref={folderInput}
        multiple
        {...{ webkitdirectory: "" }}
        onChange={async (e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!list.length) return;
          stopImport.current = false;
          setImporting(true);
          setProgress({ completed: 0, total: null, name: "" });
          try {
            const raw = list.map((file) => ({ relativePath: file.webkitRelativePath || file.name, file }));
            const plan = await planFolder(raw);
            setProgress({ completed: 0, total: plan.count, name: "" });
            await importFolder(raw, "", true, plan);
          } catch (err) {
            onError(message(err));
          } finally {
            setImporting(false);
          }
        }}
      />
      {deckChoice ? (
        <div className="modal-overlay">
          <section
            className="gdocs-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-deck-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && deckChoice.resolve(null)}
          >
            <div className="dialog-header">
              <h2 id="folder-deck-title">Which presentation?</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Cancel import"
                onClick={() => deckChoice.resolve(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p className="dialog-note">This folder contains more than one markdown file.</p>
              <ul className="folder-deck-list">
                {deckChoice.choices.map((path) => (
                  <li key={path}>
                    <button type="button" onClick={() => deckChoice.resolve(path)}>
                      {path}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      ) : null}
      {pictures ? (
        <MarpPicturesDialog
          markdown={pictures.markdown}
          name={pictures.name}
          paths={pictures.paths}
          onDone={pictures.resolve}
        />
      ) : null}
      {review ? (
        <CsvImportDialog
          draft={review.draft}
          onDone={(options) => {
            setReview(null);
            review.resolve(options);
          }}
        />
      ) : null}
    </>
  );
}

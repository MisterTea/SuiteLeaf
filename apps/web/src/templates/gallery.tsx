import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, MoreHorizontal, Search } from "lucide-react";
import {
  nativeFilename,
  type SuiteFile,
} from "@suiteleaf/core";
import { saveNewDriveFile } from "../node-client";
import { storage } from "../storage";
import { useMode } from "../mode";
import { DriveDialog } from "../drive/DriveBrowser";
import { TemplatePreview } from "./preview";
import {
  groupLabel,
  instantiate,
  kindLabel,
  loadTemplates,
  saveAsTemplate,
  suggestTemplateName,
  type TemplateEntry,
} from "./model";
import { TEMPLATES_CHANGED, templateStore } from "./store";

async function openCreated(file: SuiteFile, cluster: boolean) {
  if (cluster) {
    const drive = await saveNewDriveFile(file, null, nativeFilename(file));
    return storage.save({ file, drive });
  }
  return storage.save({ file });
}

export function useTemplates() {
  const [entries, setEntries] = useState<TemplateEntry[] | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setError("");
    return loadTemplates()
      .then(setEntries)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, []);
  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener(TEMPLATES_CHANGED, onChange);
    return () => window.removeEventListener(TEMPLATES_CHANGED, onChange);
  }, [reload]);
  return { entries, error, reload };
}

function matches(entry: TemplateEntry, query: string, kind: string) {
  if (kind && entry.info.kind !== kind) return false;
  const q = query.trim().toLowerCase();
  return !q || entry.info.name.toLowerCase().includes(q);
}

export function TemplateHome() {
  const navigate = useNavigate();
  const { entries, error, reload } = useTemplates();
  const [preview, setPreview] = useState<TemplateEntry | null>(null);
  return (
    <section className="template-band" aria-label="Start from a template">
      <header>
        <h2>Start from a template</h2>
        <button type="button" onClick={() => navigate("/templates")}>
          Template gallery
          <ChevronRight size={16} />
        </button>
      </header>
      {error ? <p className="template-error">{error}</p> : null}
      <div className="template-scroller">
        {(entries ?? []).map((entry) => (
          <TemplateCard
            key={entry.info.id}
            entry={entry}
            onOpen={() => setPreview(entry)}
            onChanged={() => void reload()}
          />
        ))}
      </div>
      {preview ? (
        <PreviewDialog entry={preview} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  );
}

function TemplateCard({
  entry,
  onOpen,
  onChanged,
}: {
  entry: TemplateEntry;
  onOpen: () => void;
  onChanged?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!card.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  return (
    <div className={`template-card ${entry.info.kind}`} ref={card}>
      <button
        type="button"
        className="template-card-open"
        aria-label={entry.info.name}
        onClick={onOpen}
      >
        <span className="template-thumb" aria-hidden="true">
          <TemplatePreview file={entry.file} compact />
        </span>
        <span className="template-card-name">{entry.info.name}</span>
        <span className="template-card-kind">
          {entry.info.source === "yours" ? "Your template · " : ""}
          {kindLabel[entry.info.kind]}
        </span>
      </button>
      {entry.info.source === "yours" ? (
        <button
          type="button"
          className="template-more"
          aria-label={`Actions for ${entry.info.name}`}
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
        >
          <MoreHorizontal size={16} />
        </button>
      ) : null}
      {menu ? (
        <div className="template-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setRemoving(true);
            }}
          >
            Remove
          </button>
        </div>
      ) : null}
      {renaming ? (
        <NamePrompt
          title="Rename template"
          submitLabel="Rename"
          initial={entry.info.name}
          onClose={() => setRenaming(false)}
          onSubmit={async (name) => {
            await templateStore.rename(entry.info.id, name);
            setRenaming(false);
            onChanged?.();
          }}
        />
      ) : null}
      {removing ? (
        <DriveDialog
          title="Remove this template?"
          submitLabel="Remove"
          onClose={() => setRemoving(false)}
          onSubmit={() => {
            void templateStore.remove(entry.info.id).then(() => {
              setRemoving(false);
              onChanged?.();
            });
          }}
        >
          <p>
            Files you already made from “{entry.info.name}” stay in your
            library.
          </p>
        </DriveDialog>
      ) : null}
    </div>
  );
}

export function TemplateGallery() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const filtered = kind === "doc" || kind === "sheet" || kind === "slide" ? kind : "";
  const { entries, error, reload } = useTemplates();
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<TemplateEntry | null>(null);
  const shown = (entries ?? []).filter((entry) => matches(entry, query, filtered));
  const yours = shown.filter((entry) => entry.info.source === "yours");
  const groups = (["doc", "sheet", "slide"] as const).filter(
    (group) => !filtered || group === filtered,
  );
  return (
    <div className="template-gallery">
      <header className="template-gallery-top">
        <button type="button" onClick={() => navigate("/")}>
          Back to files
        </button>
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Search templates"
            placeholder="Search templates"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
        </label>
      </header>
      <div className="template-gallery-body">
        <p className="eyebrow">TEMPLATES ON THIS COMPUTER</p>
        <h1>Start from a template</h1>
        <p className="template-lead">
          Look first. A file is created only when you choose Use template, and
          it works with no connection and no account.
        </p>
        {filtered ? (
          <p className="template-filter">
            Showing {groupLabel[filtered].toLowerCase()}.
            <button type="button" onClick={() => setParams({})}>
              Show all templates
            </button>
          </p>
        ) : null}
        {error ? <p className="template-error">{error}</p> : null}
        {query.trim() && shown.length === 0 ? (
          <div className="empty">
            <Search size={30} />
            <h3>No templates match “{query.trim()}”</h3>
            <p>Search looks at template names.</p>
          </div>
        ) : (
          <>
            {yours.length ? (
              <TemplateGroup
                title="Your templates"
                entries={yours}
                onOpen={setPreview}
                onChanged={() => void reload()}
              />
            ) : null}
            {groups.map((group) => {
              const items = shown.filter(
                (entry) => entry.info.source === "builtin" && entry.info.kind === group,
              );
              if (!items.length) return null;
              return (
                <TemplateGroup
                  key={group}
                  title={groupLabel[group]}
                  entries={items}
                  onOpen={setPreview}
                />
              );
            })}
          </>
        )}
      </div>
      {preview ? (
        <PreviewDialog entry={preview} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

function TemplateGroup({
  title,
  entries,
  onOpen,
  onChanged,
}: {
  title: string;
  entries: TemplateEntry[];
  onOpen: (entry: TemplateEntry) => void;
  onChanged?: () => void;
}) {
  return (
    <section className="template-group" aria-label={title}>
      <h2>{title}</h2>
      <div className="template-grid">
        {entries.map((entry) => (
          <TemplateCard
            key={entry.info.id}
            entry={entry}
            onOpen={() => onOpen(entry)}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  );
}

function PreviewDialog({
  entry,
  onClose,
}: {
  entry: TemplateEntry;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { mode } = useMode();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const use = () => {
    setBusy(true);
    void openCreated(instantiate(entry), mode.kind === "cluster")
      .then((saved) =>
        navigate(`/file/${saved.file.id}`, { state: { selectTitle: true } }),
      )
      .catch((e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };
  return (
    <div
      className="modal-overlay"
      onMouseDown={onClose}
    >
      <div
        className="gdocs-dialog template-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${entry.info.name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>
            {entry.info.name}
            <small>{kindLabel[entry.info.kind]}</small>
          </h2>
          <button type="button" className="dialog-close-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="template-preview-note">{entry.info.description}</p>
        <div className="template-preview-stage">
          <TemplatePreview file={entry.file} />
        </div>
        {error ? <p className="template-error">{error}</p> : null}
        <p className="template-preview-foot">
          Nothing is created until you use the template. Closing this leaves
          your files unchanged.
        </p>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="dialog-primary-btn" disabled={busy} onClick={use}>
            Use template
          </button>
        </div>
      </div>
    </div>
  );
}

function NamePrompt({
  title,
  submitLabel,
  initial,
  note,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial: string;
  note?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const name = value.trim();
  return (
    <DriveDialog
      title={title}
      submitLabel={submitLabel}
      canSubmit={!!name}
      onClose={onClose}
      onSubmit={() => {
        void onSubmit(name).catch((e: unknown) =>
          setError(e instanceof Error ? e.message : String(e)),
        );
      }}
    >
      {note ? <p className="dialog-note">{note}</p> : null}
      <div className="floating-field">
        <label htmlFor="template-name">Template name</label>
        <input
          id="template-name"
          ref={input}
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      {error ? <p className="template-error">{error}</p> : null}
    </DriveDialog>
  );
}

export function SaveTemplateDialog({
  file,
  onClose,
  onSaved,
}: {
  file: SuiteFile;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  return (
    <NamePrompt
      title="Save as template"
      submitLabel="Save"
      initial={suggestTemplateName(file.title)}
      note="Saved on this computer, with no account. The file you have open stays as it is, and later edits won't change this template."
      onClose={onClose}
      onSubmit={async (name) => {
        await saveAsTemplate(name, file);
        onSaved(name);
      }}
    />
  );
}

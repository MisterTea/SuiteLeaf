import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { wrappedImage } from "./doc-image-crop";
import { TableKit } from "@tiptap/extension-table";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { Equation } from "./doc-equations";
import { MoreHorizontal, X } from "lucide-react";
import {
  applyParagraphRestore,
  compareParagraphs,
  duplicateFile,
  extensionFor,
  paragraphRestorePrompt,
  parseFile,
  parseNamedFile,
  serializeFile,
  type FileRecord,
  type JsonNode,
  type SuiteFile,
} from "@suiteleaf/core";
import { drive, uploadDriveFile } from "../node-client";
import { storage } from "../storage";
import {
  paragraphRestoreExtension,
  type ParagraphRestoreControl,
} from "./doc-paragraph-restore-ui";

export type { ParagraphRestoreControl };
import {
  localVersions,
  nameLocalVersion,
  recordLocalParagraphRestore,
  restoreLocalVersion,
  type LocalVersion,
} from "./local-versions";
import {
  copyFilename,
  copyTitle,
  dayHeading,
  groupVersions,
  partialRestoreTitle,
  restoreHeading,
  restorePrompt,
  versionWhen,
  type ChangeUnit,
  type HistoryVersion,
} from "./version-history-model";
import { historyPreviewFor, type HistoryPreview } from "./version-compare";

const previewExtensions: Extensions = [
  StarterKit.configure({
    link: { openOnClick: false },
  }),
  TextStyleKit,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  wrappedImage,
  TableKit,
  Superscript,
  Subscript,
  Equation,
];

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function entryLines(
  version: HistoryVersion,
  isHead: boolean,
  all: HistoryVersion[],
) {
  if (version.restoredFrom) {
    return {
      kicker: isHead ? "Current version" : undefined,
      title: restoreHeading(
        all.find((item) => item.id === version.restoredFrom),
        version.authorName,
      ),
    };
  }
  if (version.name) {
    return {
      kicker: isHead ? "Current version" : undefined,
      title: version.name,
      subtitle: `${versionWhen(version.createdAt)} · ${version.authorName}`,
    };
  }
  const when = `${versionWhen(version.createdAt)} · ${version.authorName}`;
  return isHead
    ? { kicker: "Current version", title: when }
    : { title: when };
}

export function VersionPreview({
  content,
  label,
  offers = null,
  onRestoreParagraph,
}: {
  content: JsonNode;
  label: string;
  offers?: (ParagraphRestoreControl | null)[] | null;
  onRestoreParagraph?: (key: string) => void;
}) {
  const offersRef = useRef(offers);
  const restoreRef = useRef(onRestoreParagraph);
  offersRef.current = offers;
  restoreRef.current = onRestoreParagraph;
  const [restoreExtension] = useState(() =>
    paragraphRestoreExtension(offersRef, restoreRef),
  );
  const editor = useEditor({
    immediatelyRender: true,
    editable: false,
    extensions: [...previewExtensions, restoreExtension],
    content,
    editorProps: {
      attributes: {
        class: "document-content",
        "aria-label": "Version preview",
        "aria-readonly": "true",
      },
      handleKeyDown: () => true,
      handlePaste: () => true,
      handleDrop: () => true,
    },
  });
  return (
    <div className="version-preview" aria-label="Version preview">
      <p className="version-preview-banner">{label}</p>
      <div className="paper version-preview-paper">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export function VersionHistory({
  record,
  getFile,
  onClose,
  onPreview,
  onRestored,
  onStatus,
  bindParagraphRestore,
}: {
  record: FileRecord;
  getFile: () => SuiteFile;
  onClose: () => void;
  onPreview: (preview: HistoryPreview | null) => void;
  onRestored: (record: FileRecord) => void;
  onStatus: (status: string) => void;
  bindParagraphRestore?: MutableRefObject<(key: string) => void>;
}) {
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const natives = useRef(new Map<string, string>());
  const [headId, setHeadId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"current" | "previous">("current");
  const [namedOnly, setNamedOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(
    null,
  );
  const [naming, setNaming] = useState<HistoryVersion | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const [changeUnit, setChangeUnit] = useState<ChangeUnit>("paragraph");
  const [viewSummary, setViewSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const preview = useRef(onPreview);
  preview.current = onPreview;
  const fileNow = useRef(getFile);
  fileNow.current = getFile;

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        if (record.drive) {
          const [list, item] = await Promise.all([
            drive.versions(record.drive.itemId),
            drive.get(record.drive.itemId),
          ]);
          if (cancel) return;
          natives.current = new Map();
          const mapped: HistoryVersion[] = list.map((version) => ({
            id: version.id,
            createdAt: version.createdAt,
            authorId: version.authorId,
            authorName: version.authorName,
            name: version.name,
            restoredFrom: version.restoredFrom,
          }));
          setVersions(mapped);
          const head = item.headVersionId ?? mapped[0]?.id ?? "";
          setHeadId(head);
          setSelectedId((current) =>
            current && mapped.some((version) => version.id === current)
              ? current
              : head,
          );
        } else {
          const snaps = await localVersions(record.file.id);
          const live = serializeFile(fileNow.current());
          const synthetic: LocalVersion = {
            id: "current",
            fileId: record.file.id,
            createdAt: fileNow.current().updatedAt,
            authorId: "local",
            authorName: "You",
            name: null,
            restoredFrom: null,
            native: live,
          };
          const rows =
            snaps[0]?.native === live ? snaps : [synthetic, ...snaps];
          if (cancel) return;
          natives.current = new Map(rows.map((row) => [row.id, row.native]));
          setVersions(rows);
          setHeadId(rows[0]?.id ?? "");
          setSelectedId((current) =>
            current && rows.some((row) => row.id === current)
              ? current
              : (rows[0]?.id ?? null),
          );
        }
      } catch (e) {
        if (!cancel) setError(message(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [record.drive, record.file.id, refresh]);

  const selected = versions.find((version) => version.id === selectedId) ?? null;
  const head = versions.find((version) => version.id === headId) ?? null;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const id = window.setTimeout(() => window.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close);
    };
  }, [menu]);

  async function loadVersion(version: HistoryVersion) {
    const cached = natives.current.get(version.id);
    if (cached) return cached;
    if (version.id === headId && version.id === "current")
      return serializeFile(fileNow.current());
    const link = record.drive;
    if (!link) throw new Error("That version is no longer on this computer.");
    const text =
      version.id === headId
        ? (await drive.read(link.itemId)).text
        : await drive.readVersion(link.itemId, version.id);
    natives.current.set(version.id, text);
    return text;
  }

  useEffect(() => {
    let cancel = false;
    if (!selected || !head || selected.id === head.id) {
      preview.current(null);
      setChangeCount(null);
      setViewSummary("");
      return;
    }
    void (async () => {
      try {
        const before = parseFile(await loadVersion(selected));
        const current = parseFile(await loadVersion(head));
        if (cancel) return;
        const against = historyPreviewFor(before, current, "current");
        if (!against) {
          preview.current(null);
          setChangeCount(null);
          setViewSummary("");
          return;
        }
        setChangeCount(against.count);
        setChangeUnit(against.unit);
        if (mode === "previous") {
          const index = versions.findIndex((version) => version.id === selected.id);
          const older = versions[index + 1];
          if (!older) {
            const earliest = historyPreviewFor(before, before, "earliest");
            setViewSummary(earliest?.summary ?? "");
            preview.current(earliest?.preview ?? null);
            return;
          }
          const previous = parseFile(await loadVersion(older));
          if (cancel) return;
          const step = historyPreviewFor(previous, before, "previous");
          if (!step) return;
          setViewSummary(step.summary);
          preview.current(step.preview);
          return;
        }
        if (
          before.kind === "doc" &&
          current.kind === "doc" &&
          against.preview.kind === "doc"
        ) {
          const againstCurrent = compareParagraphs(before.content, current.content);
          const source = selected.name
            ? `"${selected.name}"`
            : versionWhen(selected.createdAt);
          const offers = againstCurrent.offers.map((offer) =>
            offer
              ? { key: offer.key, prompt: paragraphRestorePrompt(offer, source) }
              : null,
          );
          setViewSummary(against.summary);
          preview.current({
            ...against.preview,
            content: againstCurrent.content,
            offers,
          });
          return;
        }
        setViewSummary(against.summary);
        preview.current(against.preview);
      } catch (e) {
        if (!cancel) setError(message(e));
      }
    })();
    return () => {
      cancel = true;
    };
    // loadVersion closes over the version cache and the open drive link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, head, headId, mode, versions, record.drive]);

  const groups = groupVersions(versions).filter(
    (group) => !namedOnly || group.version.name,
  );
  let day = "";

  const chooseName = (version: HistoryVersion) => {
    setMenu(null);
    setNaming(version);
    setNameDraft(version.name ?? "");
    setSelectedId(version.id);
  };

  const saveName = async () => {
    if (!naming) return;
    const name = nameDraft.trim();
    if (!name) {
      setError("Type a name for this version.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (record.drive)
        await drive.nameVersion(record.drive.itemId, naming.id, name);
      else await nameLocalVersion(naming.id, name);
      setNaming(null);
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const makeCopy = async (version: HistoryVersion) => {
    setMenu(null);
    setBusy(true);
    setError("");
    try {
      const file = fileNow.current();
      const filename = copyFilename(
        file.title,
        version.authorName,
        version.createdAt,
        extensionFor(file.kind),
      );
      if (record.drive) {
        await drive.copyVersion(record.drive.itemId, version.id, filename);
      } else {
        const native =
          natives.current.get(version.id) ??
          (await localVersions(file.id)).find((item) => item.id === version.id)
            ?.native;
        if (!native) throw new Error("That version is no longer on this computer.");
        await storage.save({
          file: duplicateFile(parseFile(native), copyTitle(filename)),
        });
      }
      const saved = record.drive
        ? `Saved “${filename}” in this folder.`
        : `Saved “${copyTitle(filename)}” with your files.`;
      setNotice(saved);
      onStatus(saved);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!selected || selected.id === headId) return;
    setBusy(true);
    setError("");
    try {
      if (record.drive) {
        const item = await drive.restoreVersion(
          record.drive.itemId,
          selected.id,
          record.drive.versionId,
        );
        const { text, versionId } = await drive.read(item.id);
        const file = parseNamedFile(item.name, text);
        onRestored({
          file,
          drive: {
            ...record.drive,
            versionId: versionId ?? item.headVersionId ?? undefined,
            syncedAt: file.updatedAt,
            name: item.name,
          },
        });
      } else {
        const native = natives.current.get(selected.id);
        if (!native) throw new Error("That version is no longer on this computer.");
        const file = await restoreLocalVersion({
          ...selected,
          fileId: record.file.id,
          native,
        });
        onRestored({ ...record, file });
      }
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  const restoreParagraph = async (key: string) => {
    if (!selected || !head || selected.id === head.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const beforeFile = parseFile(await loadVersion(selected));
      const live = fileNow.current();
      if (beforeFile.kind !== "doc" || live.kind !== "doc")
        throw new Error("Only a document can restore one paragraph.");
      const offer = compareParagraphs(beforeFile.content, live.content).offers.find(
        (item) => item?.key === key,
      );
      if (!offer) throw new Error("That paragraph matches the current document.");
      const content = applyParagraphRestore(live.content, beforeFile.content, key);
      const nextFile: SuiteFile = {
        ...live,
        content,
        updatedAt: new Date().toISOString(),
      };
      const name = partialRestoreTitle(offer.label);
      if (record.drive) {
        let link = record.drive;
        const stored = parseFile(await loadVersion(head));
        if (
          stored.kind !== "doc" ||
          JSON.stringify(stored.content) !== JSON.stringify(live.content)
        )
          link = await uploadDriveFile(live, link);
        link = await uploadDriveFile(nextFile, link);
        if (link.versionId)
          await drive.nameVersion(link.itemId, link.versionId, name);
        onRestored({ file: nextFile, drive: link });
      } else {
        await recordLocalParagraphRestore(live, nextFile, name);
        onRestored({ ...record, file: nextFile });
      }
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  if (bindParagraphRestore) bindParagraphRestore.current = (key) => void restoreParagraph(key);

  return (
    <aside className="version-history" aria-label="Version history">
      <header className="version-history-header">
        <h2>Version history</h2>
        <button type="button" aria-label="Close version history" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <label className="version-filter">
        <input
          type="checkbox"
          checked={namedOnly}
          onChange={(event) => setNamedOnly(event.target.checked)}
        />
        Named versions only
      </label>
      <div className="version-compare" role="group" aria-label="What to compare">
        <button
          type="button"
          aria-pressed={mode === "current"}
          onClick={() => setMode("current")}
        >
          Compare with current
        </button>
        <button
          type="button"
          aria-pressed={mode === "previous"}
          onClick={() => setMode("previous")}
        >
          Changes in this version
        </button>
      </div>
      {viewSummary ? <p className="version-compare-summary">{viewSummary}</p> : null}
      {naming ? (
        <form
          className="version-name-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveName();
          }}
        >
          <label>
            Name this version
            <input
              aria-label="Version name"
              value={nameDraft}
              maxLength={80}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          <div>
            <button type="submit" disabled={busy}>
              Save name
            </button>
            <button type="button" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <div className="version-list">
        {loading ? <p className="version-empty">Loading versions…</p> : null}
        {!loading && groups.length === 0 ? (
          <p className="version-empty">
            {namedOnly
              ? "No named versions yet. Use the ··· menu on a version to name it."
              : "Versions appear as the file is saved. Nothing earlier is kept yet."}
          </p>
        ) : null}
        {groups.map((group) => {
          const heading = dayHeading(group.version.createdAt);
          const showDay = heading !== day;
          day = heading;
          const open = expanded.has(group.version.id);
          return (
            <div key={group.version.id}>
              {showDay ? <h3 className="version-day">{heading}</h3> : null}
              <VersionRow
                version={group.version}
                all={versions}
                headId={headId}
                selected={selectedId === group.version.id}
                expandable={group.earlier.length > 0}
                expanded={open}
                onToggle={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(group.version.id)) next.delete(group.version.id);
                    else next.add(group.version.id);
                    return next;
                  })
                }
                onSelect={() => {
                  setSelectedId(group.version.id);
                  setMode("current");
                }}
                onMenu={(button) => {
                  const rect = button.getBoundingClientRect();
                  setMenu({
                    id: group.version.id,
                    top: rect.bottom + 4,
                    left: Math.max(8, rect.right - 196),
                  });
                }}
              />
              {open
                ? group.earlier.map((version) => (
                    <VersionRow
                      key={version.id}
                      version={version}
                      all={versions}
                      headId={headId}
                      selected={selectedId === version.id}
                      nested
                      onSelect={() => {
                        setSelectedId(version.id);
                        setMode("current");
                      }}
                      onMenu={(button) => {
                        const rect = button.getBoundingClientRect();
                        setMenu({
                          id: version.id,
                          top: rect.bottom + 4,
                          left: Math.max(8, rect.right - 196),
                        });
                      }}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
      {notice ? <p className="version-notice">{notice}</p> : null}
      {error ? (
        <p className="version-error" role="alert">
          {error}
        </p>
      ) : null}
      {selected && selected.id !== headId ? (
        <footer className="version-restore">
          <p>
            {changeCount !== null
              ? restorePrompt(selected, changeCount, new Date(), changeUnit)
              : `Restore ${selected.name ? `"${selected.name}"` : "this version"}? The current version stays in history.`}
          </p>
          <button type="button" disabled={busy} onClick={() => void restore()}>
            Restore this version
          </button>
        </footer>
      ) : null}
      {menu ? (
        <div
          className="version-menu"
          role="menu"
          style={{ top: menu.top, left: menu.left }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const version = versions.find((item) => item.id === menu.id);
              if (version) chooseName(version);
            }}
          >
            Name this version
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const version = versions.find((item) => item.id === menu.id);
              if (version) void makeCopy(version);
            }}
          >
            Make a copy
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function VersionRow({
  version,
  all,
  headId,
  selected,
  nested = false,
  expandable = false,
  expanded = false,
  onToggle,
  onSelect,
  onMenu,
}: {
  version: HistoryVersion;
  all: HistoryVersion[];
  headId: string;
  selected: boolean;
  nested?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  onMenu: (button: HTMLButtonElement) => void;
}) {
  const lines = entryLines(version, version.id === headId, all);
  return (
    <div className={`version-row${selected ? " selected" : ""}${nested ? " nested" : ""}`}>
      {expandable ? (
        <button
          type="button"
          className={`version-expand${expanded ? " open" : ""}`}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide earlier autosaves" : "Show earlier autosaves"}
          onClick={onToggle}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="version-expand-spacer" />
      )}
      <button type="button" className="version-entry" onClick={onSelect}>
        {lines.kicker ? <span className="version-kicker">{lines.kicker}</span> : null}
        <span className="version-title">{lines.title}</span>
        {lines.subtitle ? (
          <span className="version-subtitle">{lines.subtitle}</span>
        ) : null}
      </button>
      <button
        type="button"
        className="version-more"
        aria-label={`Actions for ${lines.title}`}
        onClick={(event) => onMenu(event.currentTarget)}
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

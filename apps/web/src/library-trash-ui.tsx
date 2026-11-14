import {
  ClipboardList,
  FileText,
  Pencil,
  Presentation,
  RotateCcw,
  Sheet,
  Star,
  Trash2,
  Copy,
  FolderInput,
} from "lucide-react";
import { useId, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { FileRecord } from "@suiteleaf/core";
import { formatModified } from "./drive/status";
import { recordSaveStatus, syncTargetHost } from "./save-state";
import { DrawingIcon } from "./drawing-home";
import {
  moveToTrashTitle,
  trashStatus,
  type LibraryFilter,
} from "./library-trash";

/** One home-screen file, including its star and Trash actions. */
export function FileLibraryRow({
  record,
  snippet,
  view,
  desktop,
  onRename,
  onDuplicate,
  onMoveToTrash,
  onRestore,
  onDeleteForever,
  onToggleStar,
  onMove,
  onDragStart,
  selection,
}: {
  record: FileRecord;
  snippet?: string;
  selection?: { checked: boolean; control: ReactNode };
  view: LibraryFilter;
  desktop: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onMoveToTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onToggleStar: () => void;
  /** Move the file into another folder of the documents folder. */
  onMove?: () => void;
  onDragStart?: (event: DragEvent) => void;
}) {
  const title = record.file.title;
  const trashed = !!record.trashedAt;
  const starred = !!record.starred;
  const saved = recordSaveStatus(record, { desktop });
  const syncHost = syncTargetHost(record.drive?.nodeUrl);
  const id = useId();
  const note = snippet ? "snippet" : record.recovery ? "recovery" : record.path ? "path" : null;
  // The link is named by the title alone; the lines under it describe the file.
  const described = [note, "saved", syncHost ? "host" : null, saved.revision ? "revision" : null]
    .filter(Boolean)
    .map((part) => `${id}-${part}`)
    .join(" ");
  return (
    <div className={`file-row${selection?.checked ? " file-row-selected" : ""}`} draggable={!!onDragStart && !trashed} onDragStart={onDragStart}>
      <div className={`file-main${selection ? " file-main-selectable" : ""}`}>
        {selection?.control}
        <Link to={`/file/${record.file.id}`} aria-label={title} aria-describedby={described}>
          <span className={`file-icon ${record.file.kind}`}>
            {record.file.kind === "doc" ? (
              <FileText size={21} />
            ) : record.file.kind === "sheet" ? (
              <Sheet size={21} />
            ) : record.file.kind === "form" ? (
              <ClipboardList size={21} />
            ) : record.file.kind === "drawing" ? (
              <DrawingIcon size={21} />
            ) : (
              <Presentation size={21} />
            )}
          </span>
          <span>
            {title}
            {note === "snippet" ? (
              <small id={`${id}-snippet`} className="file-snippet">{snippet}</small>
            ) : null}
            {note === "recovery" ? (
              <small id={`${id}-recovery`}>Recovery draft available</small>
            ) : null}
            {note === "path" ? <small id={`${id}-path`}>{record.path}</small> : null}
            <small id={`${id}-saved`} className="file-save-where">{saved.label}</small>
            {syncHost ? <small id={`${id}-host`}>SuiteDrive on {syncHost}</small> : null}
            {saved.revision ? (
              <time id={`${id}-revision`} dateTime={saved.revision}>{saved.revision}</time>
            ) : null}
          </span>
        </Link>
        {trashed && view !== "trash" ? (
          <span className="in-trash-label">In Trash</span>
        ) : null}
        {trashed && view === "trash" ? (
          <small className="file-trash-status">{trashStatus(record)}</small>
        ) : null}
      </div>
      <time
        dateTime={record.file.updatedAt}
        title={new Date(record.file.updatedAt).toLocaleString()}
      >
        {formatModified(record.file.updatedAt)}
      </time>
      <div className="file-controls">
        {trashed ? (
          <>
            <button
              type="button"
              aria-label={`Restore ${title}`}
              title="Restore"
              onClick={onRestore}
            >
              <RotateCcw size={16} />
              <span className="restore-label">Restore</span>
            </button>
            <button
              type="button"
              aria-label={`Delete ${title} forever`}
              title={
                desktop
                  ? "Delete forever. The saved file stays on disk."
                  : "Delete forever"
              }
              onClick={onDeleteForever}
            >
              <Trash2 size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={starred ? "starred" : ""}
              aria-pressed={starred}
              aria-label={starred ? `Unstar ${title}` : `Star ${title}`}
              title={starred ? "Unstar" : "Star"}
              onClick={onToggleStar}
            >
              <Star
                size={16}
                fill={starred ? "#f9ab00" : "none"}
                color={starred ? "#f9ab00" : "currentColor"}
              />
            </button>
            <button
              type="button"
              title="Rename"
              aria-label={`Rename ${title}`}
              onClick={onRename}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              title="Make a copy"
              aria-label={`Duplicate ${title}`}
              onClick={onDuplicate}
            >
              <Copy size={16} />
            </button>
            {onMove ? (
              <button
                type="button"
                title="Move to folder"
                aria-label={`Move ${title} to a folder`}
                onClick={onMove}
              >
                <FolderInput size={16} />
              </button>
            ) : null}
            <button
              type="button"
              title={moveToTrashTitle(desktop)}
              aria-label={`Move ${title} to Trash`}
              onClick={onMoveToTrash}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The undo notice after a file moves to Trash. It stays until dismissed or the timer ends. */
export function TrashToast({
  text,
  onUndo,
  onDismiss,
}: {
  text: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="trash-toast" role="status">
      <span>{text}</span>
      <button type="button" className="trash-undo" onClick={onUndo}>
        Undo
      </button>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

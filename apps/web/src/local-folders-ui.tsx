import { useState, type DragEvent, type ReactNode } from "react";
import { Check, ChevronRight, Folder, FolderInput, Pencil } from "lucide-react";
import { DriveDialog } from "./drive/drive-dialog";
import { folderName, folderTrail, isWithinFolder, moveTargets, parentFolder } from "./local-folders";

const FILE_TYPE = "application/x-suiteleaf-file";
const FOLDER_TYPE = "application/x-suiteleaf-folder";

/** Something dragged from the home screen: a library file, or a folder by its path. */
export type DraggedItem = { file: string } | { folder: string };

export function dragFile(event: DragEvent, id: string) {
  event.dataTransfer.setData(FILE_TYPE, id);
  event.dataTransfer.effectAllowed = "move";
}

function dragFolder(event: DragEvent, folder: string) {
  event.dataTransfer.setData(FOLDER_TYPE, folder);
  event.dataTransfer.effectAllowed = "move";
}

function dragged(event: DragEvent): DraggedItem | null {
  const file = event.dataTransfer.getData(FILE_TYPE);
  if (file) return { file };
  const folder = event.dataTransfer.getData(FOLDER_TYPE);
  return folder ? { folder } : null;
}

/** Whether dropping `item` on `target` would change anything. */
export function canDrop(item: DraggedItem, target: string) {
  if ("file" in item) return true;
  return parentFolder(item.folder) !== target && !isWithinFolder(target, item.folder);
}

/** Props that make an element accept dragged files and folders, highlighted while one hovers. */
function useDropTarget(target: string, onDrop: (item: DraggedItem, target: string) => void) {
  const [over, setOver] = useState(false);
  const carries = (event: DragEvent) =>
    event.dataTransfer.types.includes(FILE_TYPE) || event.dataTransfer.types.includes(FOLDER_TYPE);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!carries(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        setOver(false);
        const item = dragged(event);
        if (!item) return;
        event.preventDefault();
        if (canDrop(item, target)) onDrop(item, target);
      },
    },
  };
}

function Crumb({
  folder,
  name,
  current,
  onOpen,
  onDrop,
}: {
  folder: string;
  name: string;
  current: boolean;
  onOpen: (folder: string) => void;
  onDrop: (item: DraggedItem, target: string) => void;
}) {
  const drop = useDropTarget(folder, onDrop);
  return (
    <button
      type="button"
      className={drop.over ? "drop-target" : undefined}
      aria-current={current ? "location" : undefined}
      disabled={current}
      onClick={() => onOpen(folder)}
      {...drop.props}
    >
      {name}
    </button>
  );
}

/** Where the home screen is in the documents folder. Each step opens that folder, and takes drops. */
export function LocalFolderCrumbs({
  folder,
  onOpen,
  onDrop,
}: {
  folder: string;
  onOpen: (folder: string) => void;
  onDrop: (item: DraggedItem, target: string) => void;
}) {
  const trail = folderTrail(folder);
  return (
    <nav className="drive-crumbs local-crumbs" aria-label="Folder path">
      {trail.map((step, i) => (
        <span key={step.folder || "top"}>
          {i ? <ChevronRight size={14} aria-hidden="true" /> : null}
          <Crumb
            folder={step.folder}
            name={step.name}
            current={i === trail.length - 1}
            onOpen={onOpen}
            onDrop={onDrop}
          />
        </span>
      ))}
    </nav>
  );
}

/** A folder in the file list. Click to open it; drop files or folders on it to move them in. */
export function LocalFolderRow({
  folder,
  count,
  onOpen,
  onRename,
  onMove,
  onDrop,
}: {
  folder: string;
  count: number;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDrop: (item: DraggedItem, target: string) => void;
}) {
  const name = folderName(folder);
  const drop = useDropTarget(folder, onDrop);
  return (
    <div
      className={`file-row folder-row${drop.over ? " drop-target" : ""}`}
      draggable
      onDragStart={(event) => dragFolder(event, folder)}
      {...drop.props}
    >
      <div className="file-main">
        <button type="button" className="folder-open" onClick={onOpen}>
          <span className="file-icon folder">
            <Folder size={21} />
          </span>
          <span>
            {name}
            <small>{count === 1 ? "1 item" : `${count} items`}</small>
          </span>
        </button>
      </div>
      <span className="folder-kind">Folder</span>
      <div className="file-controls">
        <button type="button" title="Rename" aria-label={`Rename folder ${name}`} onClick={onRename}>
          <Pencil size={16} />
        </button>
        <button type="button" title="Move to folder" aria-label={`Move folder ${name}`} onClick={onMove}>
          <FolderInput size={16} />
        </button>
      </div>
    </div>
  );
}

/** Choose the folder a file or folder moves into. */
export function LocalMoveDialog({
  name,
  from,
  folders,
  moving,
  onClose,
  onMove,
}: {
  name: string;
  /** The folder it is in now. */
  from: string;
  folders: string[];
  /** Set when a folder is moving, so it cannot go inside itself. */
  moving?: string;
  onClose: () => void;
  onMove: (target: string) => void;
}): ReactNode {
  const [choice, setChoice] = useState<string | null>(null);
  const targets = moveTargets(folders, from, moving);
  return (
    <DriveDialog
      title="Move"
      submitLabel="Move here"
      canSubmit={choice !== null}
      onSubmit={() => choice !== null && onMove(choice)}
      onClose={onClose}
    >
      <p className="dialog-note">
        {name} is in {folderName(from)}.
      </p>
      {targets.length === 0 ? (
        <p className="drive-empty">There are no other folders.</p>
      ) : (
        <ul className="move-folder-list">
          {targets.map((target) => {
            const pressed = choice === target.folder;
            return (
              <li key={target.folder || "top"}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  className={pressed ? "is-chosen" : ""}
                  onClick={() => setChoice(target.folder)}
                >
                  <Folder size={16} aria-hidden="true" />
                  <span>{target.label}</span>
                  {pressed ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DriveDialog>
  );
}

import type { DragEvent, RefObject } from "react";

/** Accept operating-system file drops anywhere on the Drive page. */
export function driveFileDrop(
  importer: RefObject<((data: DataTransfer) => Promise<void>) | null>,
) {
  return {
    onDragOver(event: DragEvent) {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDrop(event: DragEvent) {
      if (event.defaultPrevented || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      void importer.current?.(event.dataTransfer);
    },
  };
}

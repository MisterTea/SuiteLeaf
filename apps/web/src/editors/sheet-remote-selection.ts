export type RemoteSelectionBox = {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Draw another person's range on top of the grid. The cell text is not included. */
export function paintRemoteSheetSelections(host: HTMLElement, boxes: RemoteSelectionBox[]) {
  host.querySelectorAll(".sheet-remote-range").forEach((mark) => mark.remove());
  for (const box of boxes) {
    if (!(box.width > 0) || !(box.height > 0)) continue;
    const mark = document.createElement("div");
    mark.className = "sheet-remote-range";
    mark.setAttribute("data-selection", box.name);
    mark.textContent = box.name;
    mark.style.position = "fixed";
    mark.style.left = `${box.left}px`;
    mark.style.top = `${box.top}px`;
    mark.style.width = `${box.width}px`;
    mark.style.height = `${box.height}px`;
    mark.style.border = "2px solid #1d6b4f";
    mark.style.boxSizing = "border-box";
    mark.style.pointerEvents = "none";
    mark.style.zIndex = "20";
    mark.style.color = "#1d6b4f";
    mark.style.fontSize = "11px";
    mark.style.lineHeight = "1.2";
    mark.style.overflow = "hidden";
    host.appendChild(mark);
  }
}

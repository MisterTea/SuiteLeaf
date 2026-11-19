// @vitest-environment jsdom
import { createFile, type FileRecord } from "@suiteleaf/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { FileLibraryRow } from "../../apps/web/src/library-trash-ui";

function record(title: string, extra: Partial<FileRecord> = {}): FileRecord {
  const file = createFile("doc", title);
  file.updatedAt = "2026-11-01T12:00:00.000Z";
  return { file, ...extra };
}

function row(item: FileRecord, desktop = false) {
  return (
    <MemoryRouter>
      <FileLibraryRow
        record={item}
        view="all"
        desktop={desktop}
        onRename={() => {}}
        onDuplicate={() => {}}
        onMoveToTrash={() => {}}
        onRestore={() => {}}
        onDeleteForever={() => {}}
        onToggleStar={() => {}}
      />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  delete window.suiteleaf;
});

it("opens a desktop tab for command, ctrl, and middle click", () => {
  const item = record("Plan");
  const open = vi.fn().mockResolvedValue(undefined);
  window.suiteleaf = { tabs: { open } } as unknown as NonNullable<typeof window.suiteleaf>;
  render(row(item, true));
  const link = screen.getByRole("link", { name: "Plan" });
  expect(link.getAttribute("title")).toContain("click");

  fireEvent.click(link, { metaKey: true });
  fireEvent.click(link, { ctrlKey: true });
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
  link.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
  expect(open).toHaveBeenCalledTimes(3);
  expect(open).toHaveBeenCalledWith(`/file/${item.file.id}`, "Plan");

  open.mockClear();
  fireEvent.click(link);
  expect(open).not.toHaveBeenCalled();
});

it("leaves command-click to the browser when desktop tabs are absent", () => {
  render(row(record("Plan"), true));
  const link = screen.getByRole("link", { name: "Plan" });
  expect(link.getAttribute("title")).toBeNull();
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
  link.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(false);
  fireEvent.click(link, { metaKey: true });
});

it("right-click runs open, download, rename, move, copy, and share", () => {
  const item = record("Plan");
  const actions = {
    onOpen: vi.fn(),
    onOpenInNewTab: vi.fn(),
    onDownload: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onMove: vi.fn(),
    onShare: vi.fn(),
  };
  render(
    <MemoryRouter>
      <FileLibraryRow
        record={item}
        view="all"
        desktop
        {...actions}
        onMoveToTrash={() => {}}
        onRestore={() => {}}
        onDeleteForever={() => {}}
        onToggleStar={() => {}}
      />
    </MemoryRouter>,
  );
  const rowEl = screen.getByRole("link", { name: "Plan" }).closest(".file-row")!;
  const openMenu = () => {
    fireEvent.contextMenu(rowEl, { clientX: 30, clientY: 40 });
    return screen.getByRole("menu", { name: "Actions for Plan" });
  };
  const menu = openMenu();
  for (const name of [
    "Open Plan",
    "Open Plan in a new tab",
    "Download Plan",
    "Rename Plan",
    "Move Plan",
    "Copy Plan",
    "Share Plan",
  ]) {
    expect(within(menu).getByRole("button", { name })).toBeTruthy();
  }
  const run = (label: string, fn: ReturnType<typeof vi.fn>) => {
    fireEvent.click(within(openMenu()).getByRole("button", { name: label }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Actions for Plan" })).toBeNull();
  };
  run("Open Plan", actions.onOpen);
  run("Open Plan in a new tab", actions.onOpenInNewTab);
  run("Download Plan", actions.onDownload);
  run("Rename Plan", actions.onRename);
  run("Move Plan", actions.onMove);
  run("Copy Plan", actions.onDuplicate);
  run("Share Plan", actions.onShare);
});

it("does not open a file menu for trash or for a row without file actions", () => {
  const { unmount } = render(
    <MemoryRouter>
      <FileLibraryRow
        record={record("Plan", { trashedAt: "2026-11-02T00:00:00.000Z" })}
        view="trash"
        desktop
        onOpen={() => {}}
        onOpenInNewTab={() => {}}
        onDownload={() => {}}
        onShare={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onMoveToTrash={() => {}}
        onRestore={() => {}}
        onDeleteForever={() => {}}
        onToggleStar={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.contextMenu(screen.getByRole("link", { name: "Plan" }), { clientX: 1, clientY: 1 });
  expect(screen.queryByRole("menu")).toBeNull();
  unmount();

  render(row(record("Plan")));
  fireEvent.contextMenu(screen.getByRole("link", { name: "Plan" }), { clientX: 1, clientY: 1 });
  expect(screen.queryByRole("menu")).toBeNull();
});

it("treats a ctrl-click that opened the menu as a context menu, not a new tab", () => {
  const item = record("Plan");
  const open = vi.fn().mockResolvedValue(undefined);
  window.suiteleaf = { tabs: { open } } as unknown as NonNullable<typeof window.suiteleaf>;
  render(
    <MemoryRouter>
      <FileLibraryRow
        record={item}
        view="all"
        desktop
        onOpen={() => {}}
        onOpenInNewTab={() => {}}
        onDownload={() => {}}
        onShare={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onMoveToTrash={() => {}}
        onRestore={() => {}}
        onDeleteForever={() => {}}
        onToggleStar={() => {}}
      />
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Plan" });
  fireEvent.contextMenu(link, { ctrlKey: true, clientX: 8, clientY: 8 });
  fireEvent.click(link, { ctrlKey: true });
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByRole("menu", { name: "Actions for Plan" })).toBeTruthy();
});

it("shows where a library file is saved and does not call a local file synced", () => {
  const { unmount } = render(row(record("Beds")));
  expect(screen.getByText("Saved on this device")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Saved to SuiteDrive");
  expect(document.body.textContent).not.toContain("secret-value");
  unmount();

  render(
    row(
      record("Beds", {
        drive: {
          nodeUrl: "http://127.0.0.1:8787",
          itemId: "secret-value",
          name: "Beds.sldoc",
          syncedAt: "2026-11-01T12:00:00.000Z",
        },
      }),
    ),
  );
  expect(screen.getByText("Saved to SuiteDrive")).toBeTruthy();
  expect(document.querySelector("time")?.getAttribute("dateTime")).toBe("2026-11-01T12:00:00.000Z");
  expect(document.body.textContent).toContain("SuiteDrive on 127.0.0.1:8787");
  expect(document.body.textContent).not.toContain("secret-value");
  cleanup();

  render(
    row(
      record("Beds", {
        drive: {
          nodeUrl: "http://127.0.0.1:8787",
          itemId: "secret-value",
          name: "Beds.sldoc",
          syncedAt: "2026-11-01T11:00:00.000Z",
        },
      }),
    ),
  );
  expect(screen.getByText("Saved on this device · not yet on SuiteDrive")).toBeTruthy();
  expect(document.body.textContent).not.toContain("2026-11-01T11:00:00.000Z");
  expect(document.body.textContent).not.toContain("Saved to SuiteDrive");
  expect(document.body.textContent).not.toContain("secret-value");
  cleanup();

  render(row(record("Beds", { path: "/tmp/Beds.sldoc" }), true));
  expect(screen.getByText("Saved to file")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Saved to SuiteDrive");
});

it("names the file link by its title and describes it with the lines under it", () => {
  render(row(record("Beds", { recovery: true })));
  const link = screen.getByRole("link", { name: "Beds" });
  expect(link.getAttribute("aria-label")).toBe("Beds");
  const described = (link.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent);
  expect(described).toEqual(["Recovery draft available", "Draft saved · choose Save As"]);
});

// @vitest-environment jsdom
import { createFile, type FileRecord } from "@suiteleaf/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
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

afterEach(() => cleanup());

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
  expect(document.body.textContent).not.toContain("Saved to SuiteDrive");
  expect(document.body.textContent).not.toContain("secret-value");
  cleanup();

  render(row(record("Beds", { path: "/tmp/Beds.sldoc" }), true));
  expect(screen.getByText("Saved to file")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Saved to SuiteDrive");
});

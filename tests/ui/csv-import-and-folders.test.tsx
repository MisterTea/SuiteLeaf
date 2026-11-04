// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CsvImportDialog } from "../../apps/web/src/csv-import";
import { parseDelimited } from "../../apps/web/src/csv";
import {
  canDrop,
  dragFile,
  LocalFolderCrumbs,
  LocalFolderRow,
  LocalMoveDialog,
} from "../../apps/web/src/local-folders-ui";

afterEach(cleanup);

function draft(name: string, text: string, delimiter = "") {
  return { name, text, ...parseDelimited(text, delimiter) };
}

function openDialog(name: string, text: string, delimiter = "") {
  const onDone = vi.fn();
  render(<CsvImportDialog draft={draft(name, text, delimiter)} onDone={onDone} />);
  return onDone;
}

const summary = () => screen.getByRole("status").textContent;
const headers = () =>
  within(screen.getByRole("table", { name: "Import preview" }))
    .getAllByRole("columnheader")
    .map((th) => th.textContent);

describe("CSV import review", () => {
  it("guesses a header, types the columns, and imports with the chosen options", async () => {
    const onDone = openDialog("people.csv", "name,zip,age,ok\nAnn,02139,30,TRUE\nBob,10001,x,FALSE");
    expect(screen.getByRole("heading", { name: "Import people.csv" })).toBeTruthy();
    expect(summary()).toBe("2 data rows · 4 columns · comma-separated, plus a header row");
    expect(headers()).toEqual(["nameText", "zipText", "ageMixed", "okTRUE/FALSE"]);
    expect(screen.getByText(/zip has codes with leading zeros, so every value in it stays text\./)).toBeTruthy();
    expect(screen.getByRole("option", { name: "Comma (detected)" })).toBeTruthy();

    await userEvent.click(screen.getByRole("checkbox", { name: /Keep code columns as text/ }));
    // 02139 is still not a number, but 10001 now is.
    expect(headers()[1]).toBe("zipMixed");
    await userEvent.click(screen.getByRole("checkbox", { name: "First row is a header" }));
    expect(summary()).toBe("3 data rows · 4 columns · comma-separated");
    expect(headers()[0]).toBe("AText");
    await userEvent.click(screen.getByRole("checkbox", { name: "Convert text to numbers and TRUE/FALSE" }));
    expect(screen.queryByRole("checkbox", { name: /Keep code columns/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onDone).toHaveBeenCalledWith({
      delimiter: ",",
      header: false,
      convert: false,
      keepIdentifiers: false,
    });
  });

  it("names several code columns and marks number cells", () => {
    openDialog("codes.csv", "a,b,c\n01,02,3\n04,05,6");
    expect(screen.getByText(/a and b have codes with leading zeros, so every value in them stays text\./)).toBeTruthy();
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells[2].className).toBe("number");
    expect(cells[0].className).toBe("");
  });

  it("re-reads the file with another separator and reports one that does not fit", async () => {
    openDialog("data.txt", 'a;b\n1;2\n"x;y', ";");
    expect(screen.getByRole("alert").textContent).toMatch(/^This separator does not fit the file:/);
    expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
    cleanup();
    openDialog("data.csv", "a;b\n1;2\n3;4");
    expect(summary()).toContain("semicolon-separated");
    await userEvent.selectOptions(screen.getByRole("combobox"), "\t");
    expect(summary()).toBe("2 data rows · 1 column · tab-separated, plus a header row");
  });

  it("offers a detected separator that is not in the list", () => {
    openDialog("data.txt", "a#b\n1#2", "#");
    expect(screen.getByRole("option", { name: "Other (detected)" })).toBeTruthy();
    expect(summary()).toContain("other-separated");
  });

  it("refuses a file with no data rows or too many cells", async () => {
    openDialog("one.csv", "name,age");
    const header = screen.getByRole("checkbox", { name: "First row is a header" }) as HTMLInputElement;
    if (!header.checked) await userEvent.click(header);
    expect(screen.getByRole("alert").textContent).toBe("There are no data rows to import.");
    cleanup();
    const wide = ["h", ...Array.from({ length: 3 }, () => "1")]
      .map(() => Array(70_000).fill("1").join(","))
      .join("\n");
    openDialog("wide.csv", wide);
    expect(screen.getByRole("alert").textContent).toBe("Imports are limited to 200,000 cells.");
    expect(screen.getByText("Showing the first 4 rows and 20 columns.")).toBeTruthy();
  });

  it("notes long previews and formulas that stay text", () => {
    openDialog("long.csv", ["a", ...Array.from({ length: 9 }, (_, i) => `=A${i}`)].join("\n"));
    expect(screen.getByText("Showing the first 6 rows.")).toBeTruthy();
    expect(screen.getByText("Formulas are not run: text that starts with = stays text.")).toBeTruthy();
  });

  it("cancels from the close button, Cancel, Escape, or the backdrop", async () => {
    const onDone = openDialog("a.csv", "a\n1");
    await userEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(onDone.mock.calls).toEqual([[null], [null], [null], [null]]);
  });

  it("labels wide sheets with double letters", () => {
    openDialog("wide.csv", Array(28).fill("1").join(",") + "\n" + Array(28).fill("2").join(","));
    // Two numeric rows look like data, so the columns keep their letters.
    expect(headers().slice(0, 2)).toEqual(["ANumber", "BNumber"]);
  });
});

function dataTransfer(types: Record<string, string> = {}) {
  const data = { ...types };
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? "",
    setData: (type: string, value: string) => {
      data[type] = value;
    },
    effectAllowed: "",
    dropEffect: "",
  };
}

describe("local folders", () => {
  it("knows which drops change something", () => {
    expect(canDrop({ file: "f" }, "Work")).toBe(true);
    expect(canDrop({ folder: "Work/A" }, "Work")).toBe(false);
    expect(canDrop({ folder: "Work" }, "Work/A")).toBe(false);
    expect(canDrop({ folder: "Work" }, "Work")).toBe(false);
    expect(canDrop({ folder: "Work/A" }, "")).toBe(true);
    expect(canDrop({ folder: "Work/A" }, "Home")).toBe(true);
  });

  it("marks a file as dragged", () => {
    const transfer = dataTransfer();
    dragFile({ dataTransfer: transfer } as never, "id-1");
    expect(transfer.getData("application/x-suiteleaf-file")).toBe("id-1");
    expect(transfer.effectAllowed).toBe("move");
  });

  it("opens each step of the path and takes drops on it", () => {
    const onOpen = vi.fn();
    const onDrop = vi.fn();
    render(<LocalFolderCrumbs folder="Work/2026" onOpen={onOpen} onDrop={onDrop} />);
    const steps = within(screen.getByRole("navigation", { name: "Folder path" })).getAllByRole("button");
    expect(steps.map((b) => b.textContent)).toEqual(["All files", "Work", "2026"]);
    expect(steps[2].getAttribute("aria-current")).toBe("location");
    expect(steps[2]).toHaveProperty("disabled", true);
    fireEvent.click(steps[1]);
    expect(onOpen).toHaveBeenCalledWith("Work");

    const file = dataTransfer({ "application/x-suiteleaf-file": "f1" });
    const over = createEvent.dragOver(steps[0], { dataTransfer: file });
    fireEvent(steps[0], over);
    expect(over.defaultPrevented).toBe(true);
    expect(steps[0].className).toBe("drop-target");
    fireEvent.dragLeave(steps[0]);
    expect(steps[0].className).toBe("");
    fireEvent.drop(steps[0], { dataTransfer: file });
    expect(onDrop).toHaveBeenCalledWith({ file: "f1" }, "");

    const other = createEvent.dragOver(steps[0], { dataTransfer: dataTransfer({ "text/plain": "x" }) });
    fireEvent(steps[0], other);
    expect(other.defaultPrevented).toBe(false);
    fireEvent.drop(steps[0], { dataTransfer: dataTransfer() });
    // A folder dropped where it already is does nothing.
    fireEvent.drop(steps[1], { dataTransfer: dataTransfer({ "application/x-suiteleaf-folder": "Work/2026" }) });
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("shows a folder row that opens, renames, moves, drags, and takes drops", () => {
    const handlers = { onOpen: vi.fn(), onRename: vi.fn(), onMove: vi.fn(), onDrop: vi.fn() };
    const { container, rerender } = render(<LocalFolderRow folder="Work/Plans" count={1} {...handlers} />);
    expect(screen.getByText("1 item")).toBeTruthy();
    fireEvent.click(container.querySelector(".folder-open")!);
    fireEvent.click(screen.getByRole("button", { name: "Rename folder Plans" }));
    fireEvent.click(screen.getByRole("button", { name: "Move folder Plans" }));
    expect([handlers.onOpen, handlers.onRename, handlers.onMove].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    const row = container.querySelector(".folder-row")!;
    const transfer = dataTransfer();
    fireEvent.dragStart(row, { dataTransfer: transfer });
    expect(transfer.getData("application/x-suiteleaf-folder")).toBe("Work/Plans");
    fireEvent.dragOver(row, { dataTransfer: dataTransfer({ "application/x-suiteleaf-folder": "Home" }) });
    expect(row.className).toContain("drop-target");
    fireEvent.drop(row, { dataTransfer: dataTransfer({ "application/x-suiteleaf-folder": "Home" }) });
    expect(handlers.onDrop).toHaveBeenCalledWith({ folder: "Home" }, "Work/Plans");
    rerender(<LocalFolderRow folder="Work/Plans" count={3} {...handlers} />);
    expect(screen.getByText("3 items")).toBeTruthy();
  });

  it("chooses where to move, leaving out where it is and inside itself", async () => {
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(
      <LocalMoveDialog
        name="Plans"
        from="Work"
        folders={["Work", "Work/Plans", "Work/Plans/Old", "Home"]}
        moving="Work/Plans"
        onClose={onClose}
        onMove={onMove}
      />,
    );
    expect(screen.getByText("Plans is in Work.")).toBeTruthy();
    const choices = screen.getAllByRole("button", { pressed: false });
    expect(choices.map((b) => b.textContent)).toEqual(["All files", "Home"]);
    const submit = screen.getByRole("button", { name: "Move here" });
    expect(submit).toHaveProperty("disabled", true);
    await userEvent.click(choices[1]);
    expect(screen.getByRole("button", { pressed: true }).textContent).toBe("Home");
    await userEvent.click(submit);
    expect(onMove).toHaveBeenCalledWith("Home");
  });

  it("says when there is nowhere else to move", () => {
    render(<LocalMoveDialog name="Notes" from="" folders={[]} onClose={() => {}} onMove={() => {}} />);
    expect(screen.getByText("Notes is in All files.")).toBeTruthy();
    expect(screen.getByText("There are no other folders.")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type DrawingFile, type FormFile, type SheetFile, type SlideFile, type SuiteFile } from "../../packages/core/src";

const fake = vi.hoisted(() => ({
  save: vi.fn(async (record: { file: { id: string } }) => record),
  saveNewDriveFile: vi.fn(async () => ({ nodeUrl: "https://n", itemId: "d1" })),
}));

vi.mock("../../apps/web/src/storage", () => ({ storage: { save: fake.save } }));
vi.mock("../../apps/web/src/node-client", () => ({
  saveNewDriveFile: fake.saveNewDriveFile,
}));

import {
  SaveTemplateDialog,
  TemplateGallery,
  TemplateHome,
} from "../../apps/web/src/templates/gallery";
import { TemplatePreview } from "../../apps/web/src/templates/preview";
import { templateStore } from "../../apps/web/src/templates/store";
import { ModeContext } from "../../apps/web/src/mode";

function Where() {
  const location = useLocation();
  return (
    <p data-testid="where">
      {location.pathname}
      {location.search}
      {location.state ? JSON.stringify(location.state) : ""}
    </p>
  );
}

function renderAt(path: string, element: React.ReactNode, cluster = false) {
  return render(
    <ModeContext.Provider
      value={{
        mode: cluster ? { kind: "cluster", serverUrl: "https://n" } : { kind: "single" },
        locked: false,
        demo: false,
      }}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/templates" element={<>{element}<Where /></>} />
          <Route path="/" element={<>{element}<Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </ModeContext.Provider>,
  );
}

const where = () => screen.getByTestId("where").textContent;

beforeEach(async () => {
  await templateStore.templates.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("template gallery", () => {
  it("groups the built-in templates and filters by name", async () => {
    renderAt("/templates", <TemplateGallery />);
    const docs = await screen.findByRole("region", { name: "Documents" });
    expect(within(docs).getByRole("button", { name: "Meeting notes" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Spreadsheets" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Presentations" })).toBeTruthy();
    const search = screen.getByRole("textbox", { name: "Search templates" });
    await userEvent.type(search, "budg");
    expect(screen.queryByRole("region", { name: "Documents" })).toBeNull();
    expect(screen.getByRole("button", { name: "Budget" })).toBeTruthy();
    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    expect(screen.getByRole("heading", { name: "No templates match “zzz”" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(search).toHaveProperty("value", "");
    await userEvent.click(screen.getByRole("button", { name: "Back to files" }));
    expect(where()).toBe("/");
  });

  it("shows one kind from the address and can show all again", async () => {
    renderAt("/templates?kind=slide", <TemplateGallery />);
    expect(await screen.findByRole("region", { name: "Presentations" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Documents" })).toBeNull();
    expect(screen.getByText(/Showing presentations\./)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show all templates" }));
    expect(await screen.findByRole("region", { name: "Documents" })).toBeTruthy();
  });

  it("ignores an unknown kind in the address", async () => {
    renderAt("/templates?kind=form", <TemplateGallery />);
    expect(await screen.findByRole("region", { name: "Documents" })).toBeTruthy();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("previews a template and creates a file only when it is used", async () => {
    renderAt("/templates", <TemplateGallery />);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice" }));
    const dialog = screen.getByRole("dialog", { name: "Preview Invoice" });
    expect(within(dialog).getByText("Spreadsheet")).toBeTruthy();
    expect(dialog.querySelector(".template-sheet td")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fake.save).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Letter" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Pitch deck" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Invoice" }));
    await userEvent.click(screen.getByRole("button", { name: "Use template" }));
    await waitFor(() => expect(fake.save).toHaveBeenCalledTimes(1));
    const saved = fake.save.mock.calls[0][0] as unknown as { file: SuiteFile; drive?: unknown };
    expect(saved.file.title).toBe("Invoice");
    expect(saved.drive).toBeUndefined();
    await waitFor(() => expect(where()).toBe(`/file/${saved.file.id}{"selectTitle":true}`));
  });

  it("saves a used template to SuiteDrive in cluster mode and shows a failure", async () => {
    renderAt("/templates", <TemplateGallery />, true);
    await userEvent.click(await screen.findByRole("button", { name: "Budget" }));
    fake.saveNewDriveFile.mockRejectedValueOnce(new Error("SuiteDrive is unreachable."));
    const use = screen.getByRole("button", { name: "Use template" });
    await userEvent.click(use);
    expect(await screen.findByText("SuiteDrive is unreachable.")).toBeTruthy();
    expect(use).toHaveProperty("disabled", false);
    await userEvent.click(use);
    await waitFor(() => expect(fake.save).toHaveBeenCalled());
    expect(fake.saveNewDriveFile.mock.calls[1]).toEqual([
      expect.objectContaining({ title: "Budget" }),
      null,
      "Budget.slsheet",
    ]);
    expect(fake.save.mock.calls[0][0]).toMatchObject({ drive: { itemId: "d1" } });
  });

  it("closes the preview when the backdrop is pressed", async () => {
    renderAt("/templates", <TemplateGallery />);
    await userEvent.click(await screen.findByRole("button", { name: "Letter" }));
    await userEvent.pointer({ keys: "[MouseLeft]", target: document.querySelector(".modal-overlay")! });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("your templates", () => {
  it("lists saved templates first and renames and removes them", async () => {
    await templateStore.save("Weekly report", createFile("doc", "Report"));
    renderAt("/templates", <TemplateGallery />);
    const yours = await screen.findByRole("region", { name: "Your templates" });
    expect(within(yours).getByText(/Your template · Document/)).toBeTruthy();

    const more = within(yours).getByRole("button", { name: "Actions for Weekly report" });
    await userEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(more);
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(more);
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const name = screen.getByLabelText("Template name");
    expect(name).toHaveProperty("value", "Weekly report");
    await userEvent.clear(name);
    expect(screen.getByRole("button", { name: "Rename" })).toHaveProperty("disabled", true);
    await userEvent.type(name, "Monthly report");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(await within(yours).findByRole("button", { name: "Monthly report" })).toBeTruthy();
    expect((await templateStore.list())[0].name).toBe("Monthly report");

    await userEvent.click(within(yours).getByRole("button", { name: "Actions for Monthly report" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    const confirm = screen.getByRole("dialog", { name: "Remove this template?" });
    expect(confirm.textContent).toContain("Files you already made from “Monthly report” stay in your library.");
    await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Your templates" })).toBeNull());
    expect(await templateStore.list()).toEqual([]);
  });

  it("shows a rename failure in the prompt", async () => {
    await templateStore.save("Mine", createFile("slide", "Deck"));
    const rename = vi.spyOn(templateStore, "rename").mockRejectedValueOnce(new Error("Disk full."));
    renderAt("/templates", <TemplateGallery />);
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Mine" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("Disk full.")).toBeTruthy();
    rename.mockRestore();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains when templates cannot be read", async () => {
    const list = vi.spyOn(templateStore, "list").mockRejectedValue(new Error("Storage is blocked."));
    renderAt("/", <TemplateHome />);
    expect(await screen.findByText("Storage is blocked.")).toBeTruthy();
    list.mockRestore();
  });
});

describe("home template band", () => {
  it("opens the gallery and previews a template, and updates when one is saved", async () => {
    renderAt("/", <TemplateHome />);
    const band = await screen.findByRole("region", { name: "Start from a template" });
    await within(band).findByRole("button", { name: "Invoice" });
    await userEvent.click(within(band).getByRole("button", { name: "Meeting notes" }));
    expect(screen.getByRole("dialog", { name: "Preview Meeting notes" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await templateStore.save("Saved here", createFile("sheet", "Plan"));
    expect(await within(band).findByRole("button", { name: "Saved here" })).toBeTruthy();
    await userEvent.click(within(band).getByRole("button", { name: "Actions for Saved here" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(within(band).queryByRole("button", { name: "Saved here" })).toBeNull());
    await userEvent.click(within(band).getByRole("button", { name: /Template gallery/ }));
    expect(where()).toBe("/templates");
  });
});

describe("save as template", () => {
  it("suggests a name without the month and saves a copy", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <SaveTemplateDialog
        file={createFile("doc", "Invoice · Café · October")}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    const name = screen.getByLabelText("Template name");
    expect(name).toHaveProperty("value", "Invoice · Café");
    expect(document.activeElement).toBe(name);
    expect(screen.getByText(/Saved on this computer, with no account/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Invoice · Café"));
    expect((await templateStore.list())[0]).toMatchObject({ name: "Invoice · Café", kind: "doc" });
  });
});

describe("template previews", () => {
  it("draws document marks, lists, and pictures", () => {
    const file = createFile("doc", "D");
    file.content = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Sub" }] },
        { type: "heading", content: [{ type: "text", text: "Plain" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Bold",
              marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }],
            },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] }] },
        { type: "orderedList", content: [{ type: "listItem" }] },
        { type: "image", attrs: { src: "data:image/png;base64,AA==" } },
        { type: "image", attrs: {} },
        { type: "paragraph" },
      ],
    } as never;
    const { container } = render(<TemplatePreview file={file} />);
    expect(container.querySelector("h3")?.textContent).toBe("Title");
    expect([...container.querySelectorAll("h4")].map((h) => h.textContent)).toEqual(["Sub"]);
    expect(container.querySelectorAll("h3")).toHaveLength(2);
    const bold = screen.getByText("Bold");
    expect(bold.style.fontWeight).toBe("700");
    expect(bold.style.fontStyle).toBe("italic");
    expect(bold.style.textDecoration).toBe("underline");
    expect(container.querySelector("ul li")?.textContent).toBe("One");
    expect(container.querySelectorAll("ol li")).toHaveLength(1);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("draws a sheet title across the columns and the logo", () => {
    const file = createFile("sheet", "S") as SheetFile;
    const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    sheet.cellData = {
      0: { 0: { v: "Heading", s: { fs: 40 } } },
      1: { 0: { v: "a" }, 1: { v: 2, s: { bl: 1 } } },
    } as never;
    file.content.images = [{ id: "i", src: "data:image/png;base64,AA==", width: 200, height: 50 }] as never;
    const { container } = render(<TemplatePreview file={file} compact />);
    const [title, ...rest] = [...container.querySelectorAll("td")];
    expect(title.colSpan).toBe(2);
    expect(title.style.fontSize).toBe("22px");
    expect(rest.map((td) => td.textContent)).toEqual(["a", "2"]);
    expect(rest[1].style.fontWeight).toBe("650");
    const logo = container.querySelector<HTMLImageElement>(".template-sheet-logo")!;
    expect([logo.style.width, logo.style.height]).toEqual(["96px", "50px"]);
    expect(container.firstElementChild?.className).toBe("template-preview sheet compact");
  });

  it("draws the first slide's shapes and text at the preview scale", () => {
    const file = createFile("slide", "P") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id] = {
      ...file.content.slides[id],
      background: { color: "#123456" },
      elements: [
        { id: "a", type: "shape", x: 1, y: 2, width: 3, height: 4, fill: "#f00" },
        { id: "b", type: "text", x: 0, y: 0, width: 9, height: 9, content: "Hi", bold: true, italic: true, align: "center" },
        { id: "c", type: "text", x: 0, y: 0, width: 9, height: 9, content: "Lo" },
        { id: "d", type: "image", x: 0, y: 0, width: 9, height: 9, src: "" },
      ],
    } as never;
    const { container } = render(<TemplatePreview file={file} compact />);
    const frame = container.querySelector<HTMLElement>(".template-slide-frame")!;
    expect(frame.style.width).toBe("112px");
    expect(frame.style.background).toContain("rgb(18, 52, 86)");
    expect(container.querySelector(".template-shape.rect")).toBeTruthy();
    const texts = [...container.querySelectorAll<HTMLElement>(".template-slide-text")];
    expect(texts.map((t) => [t.textContent, t.style.fontWeight, t.style.textAlign])).toEqual([
      ["Hi", "700", "center"],
      ["Lo", "500", "left"],
    ]);
  });

  it("shows drawing source and form questions", () => {
    const drawing = createFile("drawing", "D") as DrawingFile;
    drawing.content.source = "graph TD; A-->B";
    render(<TemplatePreview file={drawing} />);
    expect(screen.getByText("graph TD; A-->B")).toBeTruthy();
    cleanup();
    const form = createFile("form", "F") as FormFile;
    form.content.questions = [
      { ...form.content.questions[0], id: "q1", prompt: "Name?" },
      { ...form.content.questions[0], id: "q2", prompt: "" },
    ] as never;
    const { container } = render(<TemplatePreview file={form} />);
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Name?",
      "Untitled question",
    ]);
  });
});

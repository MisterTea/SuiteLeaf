// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocFile } from "@suiteleaf/core";
import { MailMergeDialog } from "../../apps/web/src/editors/mail-merge-dialog";

const garden = {
  id: "sheet-1",
  kind: "sheet" as const,
  title: "Garden",
  content: {
    workbook: {
      sheetOrder: ["s"],
      sheets: {
        s: {
          cellData: {
            "0": { "0": { v: "Name" }, "1": { v: "Plot" } },
            "1": { "0": { v: "Rosa" }, "1": { v: "North" } },
            "2": { "0": { v: "Ada" }, "1": { v: "South" } },
          },
        },
      },
    },
  },
};

vi.mock("../../apps/web/src/storage", () => ({
  storage: {
    list: async () => [{ file: garden }],
    get: async (id: string) => (id === garden.id ? { file: garden } : null),
  },
}));

vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => null,
  drive: { spreadsheets: async () => [], read: async () => ({ text: "" }) },
}));

afterEach(cleanup);

const template = () => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Hello {{Name}}, plot {{Plot}}." }],
    },
  ],
});

describe("merge dialog", () => {
  it("creates one document per row", async () => {
    const created: DocFile[][] = [];
    render(
      <MailMergeDialog
        template={template}
        sourceTitle="Garden notes"
        onClose={() => {}}
        onCreate={async (files) => {
          created.push(files);
        }}
      />,
    );
    expect(screen.getByText(/kept only when Plot has text/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("radio", { name: /Garden/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].map((file) => file.title)).toEqual([
      "Garden notes — Rosa",
      "Garden notes — Ada",
    ]);
    expect(JSON.stringify(created[0][0].content)).toContain("Hello Rosa");
    expect(JSON.stringify(created[0][1].content)).toContain("plot South");
  });

  it("shows a blank cell and writes nothing", async () => {
    garden.content.workbook.sheets.s.cellData["1"]["1"] = { v: "" };
    const created: DocFile[][] = [];
    render(
      <MailMergeDialog
        template={template}
        sourceTitle="Garden notes"
        onClose={() => {}}
        onCreate={async (files) => {
          created.push(files);
        }}
      />,
    );
    fireEvent.click(await screen.findByRole("radio", { name: /Garden/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Row 1 has no Plot. Cell B2.",
    );
    expect(created).toHaveLength(0);
    garden.content.workbook.sheets.s.cellData["1"]["1"] = { v: "North" };
  });

  it("places each row on an Avery 5160 label", async () => {
    const created: DocFile[][] = [];
    render(
      <MailMergeDialog
        template={template}
        sourceTitle="Garden notes"
        onClose={() => {}}
        onCreate={async (files) => {
          created.push(files);
        }}
      />,
    );
    fireEvent.click(await screen.findByRole("radio", { name: "Labels" }));
    fireEvent.click(screen.getByRole("radio", { name: /Garden/ }));
    fireEvent.click(screen.getByRole("button", { name: "Place on labels" }));
    const sheet = await screen.findByLabelText("Avery 5160");
    expect(sheet.textContent).toContain("Rosa");
    expect(sheet.textContent).toContain("Ada");
    expect(sheet.textContent).toContain("Nothing is mailed.");
    expect(created).toHaveLength(0);
  });

  it("prepares one PDF per row and does not create a document", async () => {
    garden.content.workbook.sheets.s.cellData["1"]["1"] = { v: "North" };
    garden.content.workbook.sheets.s.cellData["2"]["1"] = { v: "secret-value" };
    const created: DocFile[][] = [];
    render(
      <MailMergeDialog
        template={template}
        sourceTitle="Garden notes"
        onClose={() => {}}
        onCreate={async (files) => {
          created.push(files);
        }}
      />,
    );
    fireEvent.click(await screen.findByRole("radio", { name: "PDF" }));
    fireEvent.click(screen.getByRole("radio", { name: /Garden/ }));
    fireEvent.click(screen.getByRole("button", { name: "Write PDFs" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Rosa.pdf");
    expect(status.textContent).toContain("Ada.pdf");
    expect(status.textContent).toContain("Nothing is mailed.");
    expect(status.textContent).not.toContain("secret-value");
    expect(created).toHaveLength(0);
    garden.content.workbook.sheets.s.cellData["2"]["1"] = { v: "South" };
  });
});

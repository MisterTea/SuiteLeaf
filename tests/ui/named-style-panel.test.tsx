// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { importParagraphStyles } from "../../packages/core/src/doc-styles";
import { NamedStylePanel } from "../../apps/web/src/editors/named-style-panel";

afterEach(cleanup);

it("updates the heading size and leaves the stored list alone", () => {
  const styles = [
    { id: "heading", name: "Heading", fontSize: 18 },
    { id: "body", name: "Body", fontSize: 12 },
  ];
  const calls: string[] = [];
  render(
    <NamedStylePanel
      styles={styles}
      onSize={(id, fontSize) => calls.push(`${id}:${fontSize}`)}
      onClose={() => calls.push("close")}
    />,
  );
  expect((screen.getByLabelText("Style size") as HTMLInputElement).value).toBe("18");
  fireEvent.change(screen.getByLabelText("Style size"), { target: { value: "22" } });
  fireEvent.click(screen.getByRole("button", { name: "Update style" }));
  expect(calls).toEqual(["heading:22"]);
  expect(styles[0].fontSize).toBe(18);
});

it("matches the selected style and shows the status", () => {
  const notes: string[] = [];
  render(
    <NamedStylePanel
      styles={[{ id: "heading", name: "Heading", fontSize: 18 }]}
      onSize={() => undefined}
      onMatch={(id) => {
        notes.push(id);
        return "The style now matches the selection.";
      }}
      onClose={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Match the selection" }));
  expect(notes).toEqual(["heading"]);
  expect(screen.getByText("The style now matches the selection.")).toBeTruthy();
});

it("adds styles from a template file and refuses text that is not JSON", async () => {
  const document = {
    attrs: { paragraphStyles: [{ id: "heading", name: "Heading", fontSize: 18 }] },
  };
  const imported: { id: string; fontSize?: number }[][] = [];
  render(
    <NamedStylePanel
      styles={[{ id: "heading", name: "Heading", fontSize: 18 }]}
      onSize={() => undefined}
      onImport={(template) => {
        imported.push(importParagraphStyles(document, template).attrs?.paragraphStyles ?? []);
      }}
      onClose={() => undefined}
    />,
  );
  const input = screen.getByLabelText("Import styles") as HTMLInputElement;
  const template = {
    attrs: { paragraphStyles: [{ id: "note", name: "Note", fontSize: 14 }] },
    secret: "secret-value",
  };
  fireEvent.change(input, {
    target: { files: [new File([JSON.stringify(template)], "styles.json", { type: "application/json" })] },
  });
  await waitFor(() => expect(imported).toHaveLength(1));
  expect(imported[0]).toEqual([
    { id: "heading", name: "Heading", fontSize: 18 },
    { id: "note", name: "Note", fontSize: 14 },
  ]);
  expect(document.attrs.paragraphStyles).toEqual([{ id: "heading", name: "Heading", fontSize: 18 }]);
  expect(screen.getByText("Styles from the template were added.").textContent).not.toContain(
    "secret-value",
  );
  fireEvent.change(input, {
    target: { files: [new File(["secret-value"], "notes.txt", { type: "text/plain" })] },
  });
  await waitFor(() => expect(screen.getByText("That file is not a style template.")).toBeTruthy());
  expect(screen.getByRole("region", { name: "Named styles" }).textContent).not.toContain("secret-value");
  expect(imported).toHaveLength(1);
});

it("applies the chosen paragraph style", () => {
  const calls: string[] = [];
  render(
    <NamedStylePanel
      styles={[{ id: "heading", name: "Heading", fontSize: 18 }]}
      onSize={() => undefined}
      onApply={(id) => {
        calls.push(id);
        return "That style was applied to this paragraph.";
      }}
      onClose={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Use this style" }));
  expect(calls).toEqual(["heading"]);
  expect(screen.getByText("That style was applied to this paragraph.")).toBeTruthy();
});

it("applies a character style from the list", () => {
  const calls: string[] = [];
  render(
    <NamedStylePanel
      styles={[{ id: "heading", name: "Heading", fontSize: 18 }]}
      characterStyles={[{ id: "emphasis", name: "Emphasis" }]}
      onSize={() => undefined}
      onApplyCharacter={(id) => calls.push(id)}
      onClose={() => undefined}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Use character style" }));
  expect(calls).toEqual(["emphasis"]);
  expect(screen.getByRole("region", { name: "Named styles" }).textContent).not.toContain(
    "secret-value",
  );
});

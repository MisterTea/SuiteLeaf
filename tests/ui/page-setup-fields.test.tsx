// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  type PageSettings,
} from "../../packages/core/src/document-layout";
import { PageSetupFields } from "../../apps/web/src/editors/page-setup";

function Fields({ initial }: { initial: Partial<PageSettings> }) {
  const [draft, setDraft] = useState(() =>
    documentPageSettings({
      type: "doc",
      attrs: { pageSettings: initial },
    }),
  );
  return (
    <PageSetupFields draft={draft} pageCount={3} onChange={setDraft} />
  );
}

const numbered = {
  pageNumbers: true,
  pageNumberFormat: "page" as const,
  pageNumberPosition: "top-right" as const,
  pageNumberPositionSet: true,
  differentOddEven: true,
};

describe("page setup fields", () => {
  it("clears the cover in the preview before apply", async () => {
    const user = userEvent.setup();
    render(<Fields initial={numbered} />);
    const cover = screen.getByRole("checkbox", {
      name: "Cover has no number",
    }) as HTMLInputElement;
    expect(cover.checked).toBe(false);
    await user.click(cover);
    const preview = screen.getByRole("group", { name: "Page preview" });
    expect(
      preview.querySelector("[data-preview-role='cover']")?.textContent,
    ).toContain("No number");
    expect(
      preview.querySelector("[data-preview-role='next']")?.textContent,
    ).toContain("Page 1");
  });

  it("keeps page 2 when the first page is different", async () => {
    const user = userEvent.setup();
    const view = render(
      <Fields
        initial={{
          pageNumbers: true,
          pageNumberFormat: "page",
          pageNumberPosition: "top-right",
          pageNumberPositionSet: true,
          header: "Garden club minutes",
        }}
      />,
    );
    const first = view.container.querySelector(
      ".page-setup-variants input",
    ) as HTMLInputElement;
    await user.click(first);
    const preview = view.container.querySelector(".page-setup-preview")!;
    const sheets = preview.querySelectorAll(".page-setup-preview-number");
    expect(sheets[0]?.textContent).toContain("No number");
    expect(sheets[1]?.textContent).toContain("Page 2");
    expect(preview.textContent).toContain("Garden club minutes");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SheetLanguageField } from "../../apps/web/src/editors/sheet-language";

afterEach(cleanup);

it("stores Spanish and says the English dictionary is not used", () => {
  const calls: string[] = [];
  render(<SheetLanguageField language="en" onChange={(language) => calls.push(language)} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Proofing language" }), {
    target: { value: "es" },
  });
  expect(calls).toEqual(["es"]);
  expect(screen.getByRole("region", { name: "Proofing language" }).textContent).toContain(
    "The text is not sent to a spelling service.",
  );
});

it("writes Hebrew from right to left", () => {
  const calls: string[] = [];
  const view = render(<SheetLanguageField language="en" onChange={(language) => calls.push(language)} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Proofing language" }), {
    target: { value: "he" },
  });
  expect(calls).toEqual(["he"]);
  view.rerender(<SheetLanguageField language="he" onChange={() => undefined} />);
  const region = screen.getByRole("region", { name: "Proofing language" });
  expect(region.getAttribute("dir")).toBe("rtl");
  expect(region.textContent).toContain("Hebrew");
  expect(region.textContent).toContain("right to left");
  expect(region.textContent).not.toContain("secret-value");
});

it("writes Arabic from right to left", () => {
  render(<SheetLanguageField language="ar" onChange={() => undefined} />);
  const region = screen.getByRole("region", { name: "Proofing language" });
  expect(region.getAttribute("dir")).toBe("rtl");
  expect(region.textContent).toContain("right to left");
  expect(region.textContent).not.toContain("secret-value");
});

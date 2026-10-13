import { expect, test } from "vitest";
import {
  displayRef,
  namedRangeError,
  suggestedName,
  type NamedRangeRecord,
} from "../apps/web/src/editors/named-ranges";

const rent: NamedRangeRecord = {
  id: "rent",
  name: "Rent",
  ref: "Budget!$C$2:$C$13",
};

const check = {
  names: [rent],
  sheetNames: ["Budget"],
  isFunction: (name: string) => name.toUpperCase() === "SUM",
};

test("a space or a cell reference is refused with a reason, and the existing name is not involved", () => {
  expect(namedRangeError("Rent payments", check)).toBe(
    '"Rent payments" includes a space. Names cannot include spaces. Try RentPayments.',
  );
  expect(suggestedName("Rent payments")).toBe("RentPayments");
  expect(namedRangeError("C14", check)).toContain("C14 is a cell reference");
  expect(namedRangeError("C14", check)).toContain("Try TotalRent");
  expect(namedRangeError("$C$14", check)).toContain("cell reference");
  expect(namedRangeError("R1C1", check)).toContain("cell reference");
  expect(namedRangeError("Rent", check)).toContain("already a named range");
  expect(namedRangeError("Rent", check)).toContain("kept");
  expect(namedRangeError("rent", { ...check, editingId: "rent" })).toBeNull();
  expect(namedRangeError("MonthlyRent", check)).toBeNull();
  expect(namedRangeError("SUM", check)).toContain("formula function");
  expect(namedRangeError("Budget", check)).toContain("already a sheet");
  expect(namedRangeError("  ", check)).toContain("Enter a name");
});

test("a stored reference is shown without dollar signs, and with the sheet when it is not the active one", () => {
  expect(displayRef("Budget!$C$2:$C$13", "Budget")).toBe("C2:C13");
  expect(displayRef("'Rent budget'!$C$2:$C$13", "Budget")).toBe(
    "Rent budget!C2:C13",
  );
  expect(displayRef("=SUM(Rent)", "Budget")).toBe("SUM(Rent)");
});

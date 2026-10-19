/** @vitest-environment jsdom */
import { expect, test } from "vitest";

import {
  checkboxForFilterLabel,
  phoneCheckboxWrite,
  shouldOpenPhoneHeaderFilter,
} from "../apps/web/src/editors/sheet-phone-gestures";

const headerBox = { left: 8, top: 40, right: 120, bottom: 64 };

test("a phone tap writes the checkbox rule's checked and unchecked values", () => {
  const rule = { checked: "TRUE", unchecked: "FALSE" };
  expect(
    phoneCheckboxWrite({
      before: { row: 4, col: 0, on: false },
      after: { row: 4, col: 0, on: false },
      scrolled: false,
      tapOnCell: true,
      ...rule,
    }),
  ).toEqual({ v: "TRUE", p: null });
  expect(
    phoneCheckboxWrite({
      before: { row: 4, col: 0, on: true },
      after: { row: 4, col: 0, on: true },
      scrolled: false,
      tapOnCell: true,
      ...rule,
    }),
  ).toEqual({ v: "FALSE", p: null });
  expect(
    phoneCheckboxWrite({
      before: null,
      after: { row: 2, col: 1, on: false },
      scrolled: false,
      tapOnCell: true,
      checked: "Yes",
      unchecked: "No",
    }),
  ).toEqual({ v: "Yes", p: null });
});

test("a scroll that leaves the same checkbox selected does not flip it", () => {
  expect(
    phoneCheckboxWrite({
      before: { row: 4, col: 0, on: false },
      after: { row: 4, col: 0, on: false },
      scrolled: true,
      tapOnCell: true,
      checked: "TRUE",
      unchecked: "FALSE",
    }),
  ).toBeNull();
  expect(
    phoneCheckboxWrite({
      before: { row: 4, col: 0, on: false },
      after: { row: 4, col: 0, on: false },
      scrolled: false,
      tapOnCell: false,
      checked: "TRUE",
      unchecked: "FALSE",
    }),
  ).toBeNull();
  expect(
    phoneCheckboxWrite({
      before: { row: 4, col: 0, on: false },
      after: { row: 4, col: 0, on: true },
      scrolled: false,
      tapOnCell: true,
      checked: "TRUE",
      unchecked: "FALSE",
    }),
  ).toBeNull();
});

test("a tap that first selects a checkbox Univer already toggled is not written again", () => {
  expect(
    phoneCheckboxWrite({
      before: null,
      after: { row: 2, col: 1, on: true },
      scrolled: false,
      tapOnCell: true,
      alreadyToggled: true,
      checked: "Yes",
      unchecked: "No",
    }),
  ).toBeNull();
  expect(
    phoneCheckboxWrite({
      before: { row: 0, col: 1, on: true },
      after: { row: 3, col: 0, on: false },
      scrolled: false,
      tapOnCell: true,
      alreadyToggled: true,
      checked: "TRUE",
      unchecked: "FALSE",
    }),
  ).toBeNull();
});

function phoneFilterList() {
  document.body.innerHTML = `
    <div data-u-comp="mobile-sheets-filter-by-values">
      <div class="univer-relative univer-my-1 univer-flex univer-w-full univer-items-center">
        <label data-u-comp="checkbox"><input type="checkbox" id="active" /></label>
        <div class="univer-mx-1 univer-flex univer-h-full"><span id="active-name">Active</span></div>
        <span id="active-count">(4)</span>
        <a id="active-only" href="#only">Only</a>
        <button id="active-button" type="button">Search</button>
        <input id="active-search" />
      </div>
      <div class="univer-relative univer-my-1 univer-flex univer-w-full univer-items-center">
        <span class="univer-flex" id="year-arrow">v</span>
        <label data-u-comp="checkbox"><input type="checkbox" id="year" /></label>
        <div class="univer-mx-1 univer-flex"><span id="year-name">2024</span></div>
      </div>
      <div class="univer-relative univer-my-1 univer-flex univer-w-full univer-items-center">
        <label data-u-comp="checkbox"><input type="checkbox" id="closed" /></label>
        <div class="univer-mx-1 univer-flex"><span id="closed-name">Closed</span></div>
      </div>
    </div>
  `;
}

test("a tap on a phone filter value's name ticks that row's checkbox", () => {
  phoneFilterList();
  const name = document.getElementById("active-name")!;
  expect(name.parentElement?.classList.contains("univer-flex")).toBe(true);
  expect(checkboxForFilterLabel(name)?.id).toBe("active");
  expect(checkboxForFilterLabel(document.getElementById("closed-name")!)?.id).toBe(
    "closed",
  );
});

test("a filter label tap ignores the checkbox, a link, a button, an input, and an expand arrow", () => {
  phoneFilterList();
  expect(checkboxForFilterLabel(document.getElementById("active")!)).toBeNull();
  expect(checkboxForFilterLabel(document.getElementById("active-only")!)).toBeNull();
  expect(checkboxForFilterLabel(document.getElementById("active-button")!)).toBeNull();
  expect(checkboxForFilterLabel(document.getElementById("active-search")!)).toBeNull();
  expect(checkboxForFilterLabel(document.getElementById("year-arrow")!)).toBeNull();
  expect(checkboxForFilterLabel(document.getElementById("year-name")!)).toBeNull();
  expect(checkboxForFilterLabel(document.getElementById("active-count")!)?.id).toBe(
    "active",
  );
});

test("the header filter opens for a tap on that cell, not a scroll or another lift", () => {
  const selected = { narrow: true, singleHeaderCell: true, headerBox };
  expect(
    shouldOpenPhoneHeaderFilter({
      ...selected,
      down: { x: 20, y: 50 },
      up: { x: 24, y: 160 },
    }),
  ).toBe(false);
  expect(
    shouldOpenPhoneHeaderFilter({
      ...selected,
      down: { x: 200, y: 300 },
      up: { x: 202, y: 301 },
    }),
  ).toBe(false);
  expect(
    shouldOpenPhoneHeaderFilter({
      ...selected,
      down: null,
      up: { x: 20, y: 50 },
    }),
  ).toBe(false);
  expect(
    shouldOpenPhoneHeaderFilter({
      ...selected,
      down: { x: 20, y: 50 },
      up: { x: 22, y: 51 },
    }),
  ).toBe(true);
  expect(
    shouldOpenPhoneHeaderFilter({
      narrow: true,
      singleHeaderCell: false,
      headerBox,
      down: { x: 20, y: 50 },
      up: { x: 22, y: 51 },
    }),
  ).toBe(false);
  expect(
    shouldOpenPhoneHeaderFilter({
      ...selected,
      narrow: false,
      down: { x: 20, y: 50 },
      up: { x: 22, y: 51 },
    }),
  ).toBe(false);
});

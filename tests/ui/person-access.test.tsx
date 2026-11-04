// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PersonAccess, personAccessLine } from "../../apps/web/src/admin/person-access";

afterEach(cleanup);

it("names the file and the group, not another member", () => {
  const line = personAccessLine({
    itemId: "file-1",
    itemName: "Watering rota.sldoc",
    role: "editor",
    source: "group",
    inheritedFrom: "Garden",
    groupName: "Garden club",
  });
  expect(line).toBe("Watering rota.sldoc as editor through Garden club from Garden.");
  expect(line).not.toContain("priya");
  expect(
    personAccessLine({
      itemId: "file-2",
      itemName: "secret-value",
      role: "secret-value",
      source: "group",
      inheritedFrom: "secret-value",
      groupName: "secret-value",
    }),
  ).toBe("this item as another role through a group from a folder.");
  expect(
    personAccessLine({
      itemId: "file-3",
      itemName: "Notes",
      role: "viewer",
      source: "org",
      inheritedFrom: null,
      groupName: null,
    }),
  ).toBe("Notes as viewer through an organization.");
});

it("lists the files and hides a secret in a refusal", async () => {
  render(
    <PersonAccess
      onLoad={async () => ({
        files: [
          {
            itemId: "file-1",
            itemName: "Watering rota.sldoc",
            role: "editor",
            source: "group",
            inheritedFrom: "Garden",
            groupName: "Garden club",
          },
        ],
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Files this person can open" }));
  expect(await screen.findByText("Watering rota.sldoc as editor through Garden club from Garden.")).toBeTruthy();
  cleanup();
  render(
    <PersonAccess
      onLoad={async () => {
        throw "secret-value";
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Files this person can open" }));
  expect(await screen.findByText("Those files could not be read.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret-value");
});

it("repeats a missing name", async () => {
  render(
    <PersonAccess
      onLoad={async () => {
        throw new Error("Name the person.");
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Files this person can open" }));
  expect(await screen.findByText("Name the person.")).toBeTruthy();
});

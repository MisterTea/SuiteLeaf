// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ExternalShareNote } from "../../apps/web/src/drive/external-share-note";
import { externalShareReview, type ShareGrant } from "../../apps/web/src/drive/external-share";

afterEach(cleanup);

const grants: ShareGrant[] = [
  { principalId: "secret-value", principalName: "Ada", member: false, itemName: "Beds" },
  { principalId: "sam", principalName: "Sam", member: true, itemName: "Beds" },
  { principalId: "hidden", principalName: "  ", member: false, itemName: "secret-value" },
];

it("names people outside the organization and leaves ids and file names out", () => {
  const before = JSON.stringify(grants);
  const review = externalShareReview(grants);
  expect(review.count).toBe(2);
  expect(review.names).toEqual(["Ada"]);
  expect(review.note).toBe("People outside this organization still have access.");
  expect(JSON.stringify(review)).not.toContain("secret-value");
  expect(JSON.stringify(grants)).toBe(before);
  render(<ExternalShareNote grants={grants} />);
  const region = screen.getByRole("region", { name: "External sharing" });
  expect(region.textContent).toContain("Ada");
  expect(region.textContent).not.toContain("Sam");
  expect(region.textContent).not.toContain("secret-value");
  expect(region.textContent).not.toContain("Beds");
});

it("leaves out a guest whose access has ended", () => {
  const grants: ShareGrant[] = [
    {
      principalId: "ada",
      principalName: "Ada",
      member: false,
      itemName: "Beds",
      expiresAt: "2026-01-01T00:00:00.000Z",
    },
    {
      principalId: "secret-value",
      principalName: "Noor",
      member: false,
      itemName: "Paths",
      expiresAt: "2026-12-01T00:00:00.000Z",
    },
    {
      principalId: "priya",
      principalName: "Priya",
      member: false,
      itemName: "Beds",
      expiresAt: "2026-02-31T00:00:00.000Z",
    },
  ];
  const now = "2026-11-01T00:00:00.000Z";
  const review = externalShareReview(grants, now);
  expect(review.names).toEqual(["Noor", "Priya"]);
  expect(review.count).toBe(2);
  expect(JSON.stringify(review)).not.toContain("secret-value");
  expect(JSON.stringify(review)).not.toContain("2026-02-31");
  render(<ExternalShareNote grants={grants} now={now} />);
  const region = screen.getByRole("region", { name: "External sharing" });
  expect(region.textContent).toContain("Noor");
  expect(region.textContent).not.toContain("Ada");
  expect(region.textContent).not.toContain("secret-value");
});

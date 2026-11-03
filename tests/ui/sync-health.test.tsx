// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OrganizationExportButton, ReplicationLagNote, SyncHealthNote } from "../../apps/web/src/admin/admin-view";

afterEach(cleanup);

describe("sync health on the admin page", () => {
  it("shows counts and a remedy without a file name", () => {
    render(
      <SyncHealthNote
        health={{
          pendingFiles: 2,
          pendingBytes: 2048,
          retrying: 1,
          needsPerson: 1,
          failures: [
            {
              kind: "conflict",
              files: 1,
              remedy: "Reload the SuiteDrive version or save a copy.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("region", { name: "Uploads from this browser" })).toBeTruthy();
    expect(screen.getByText(/2 files waiting/)).toBeTruthy();
    expect(screen.getByText(/1 retrying/)).toBeTruthy();
    expect(screen.getByText(/Reload the SuiteDrive version/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("Budget");
    expect(screen.getByText(/No upload has succeeded from this browser/)).toBeTruthy();
    cleanup();
    render(
      <SyncHealthNote
        health={{
          pendingFiles: 0,
          pendingBytes: 0,
          retrying: 0,
          needsPerson: 0,
          failures: [],
          lastSuccessAt: Date.parse("2026-11-01T00:00:00.000Z"),
        }}
      />,
    );
    expect(screen.getByText(/The last successful upload was at 2026-11-01T00:00:00.000Z/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-value");
  });

  it("shows how far behind another node is without document text", () => {
    render(
      <ReplicationLagNote
        pending={0}
        peers={[
          { peer: "peer-a", sameEpoch: true, behind: 3 },
          { peer: "peer-b", sameEpoch: false, behind: 4 },
        ]}
      />,
    );
    expect(screen.getByRole("region", { name: "Replication" })).toBeTruthy();
    expect(screen.getByText("3 operations behind")).toBeTruthy();
    expect(screen.getByText(/Different database/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret body");
  });

  it("offers an organization export that leaves passwords out of the description", () => {
    let clicks = 0;
    render(<OrganizationExportButton busy={false} error="" onExport={() => { clicks += 1; }} />);
    expect(screen.getByRole("region", { name: "Organization export" }).textContent).toContain(
      "Passwords and file bytes are not included.",
    );
    expect(screen.getByRole("region", { name: "Organization export" }).textContent).toContain(
      "a file list with names, owners, the folder each file is in, and whether a file is in the trash",
    );
    fireEvent.click(screen.getByRole("button", { name: "Download export" }));
    expect(clicks).toBe(1);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BackupFreshnessNote } from "../../apps/web/src/admin/admin-view";

afterEach(cleanup);

it("shows the backup time and the restore test without a hash", () => {
  const { rerender } = render(
    <BackupFreshnessNote
      report={{
        configured: true,
        readable: true,
        recordedAt: "2026-10-31T12:00:00.000Z",
        contentCount: 1,
        drilledAt: "2026-10-31T13:00:00.000Z",
        elapsedMs: 12,
        restoreTested: true,
      }}
    />,
  );
  const region = screen.getByRole("region", { name: "Backup" });
  expect(region.textContent).toContain("2026-10-31T12:00:00.000Z");
  expect(region.textContent).toContain("Restore test 2026-10-31T13:00:00.000Z, 12 ms.");
  expect(region.textContent).not.toContain("secret-hash-value");
  rerender(
    <BackupFreshnessNote
      report={{
        configured: true,
        readable: true,
        recordedAt: "2026-10-31T12:00:00.000Z",
        contentCount: 1,
        restoreTested: false,
      }}
    />,
  );
  expect(screen.getByRole("region", { name: "Backup" }).textContent).toContain(
    "No successful restore test is recorded.",
  );
  rerender(
    <BackupFreshnessNote
      report={{
        configured: true,
        readable: true,
        recordedAt: "secret-value",
        contentCount: 1,
        drilledAt: "secret-value",
        elapsedMs: 12,
        restoreTested: true,
      }}
    />,
  );
  const hidden = screen.getByRole("region", { name: "Backup" }).textContent ?? "";
  expect(hidden).toContain("The backup time is not a date.");
  expect(hidden).toContain("The restore test time is not a date.");
  expect(hidden).not.toContain("secret-value");
  rerender(
    <BackupFreshnessNote
      report={{
        configured: true,
        readable: true,
        recordedAt: "2026-10-31T12:00:00.000Z",
        contentCount: 1,
        drilledAt: "2026-10-31T11:00:00.000Z",
        elapsedMs: 12,
        restoreTested: true,
      }}
    />,
  );
  const older = screen.getByRole("region", { name: "Backup" }).textContent ?? "";
  expect(older).toContain("Restore test 2026-10-31T11:00:00.000Z is older than this backup.");
  expect(older).not.toContain("12 ms");
  rerender(
    <BackupFreshnessNote
      report={{
        configured: true,
        readable: true,
        recordedAt: "2026-10-31T12:00:00.000Z",
        contentCount: 1,
        restoreTested: false,
        due: true,
        schedule: "A backup is due.",
      }}
    />,
  );
  expect(screen.getByRole("region", { name: "Backup" }).textContent).toContain("A backup is due.");
  rerender(
    <BackupFreshnessNote
      report={{
        configured: true,
        readable: true,
        recordedAt: "2026-10-31T12:00:00.000Z",
        contentCount: 1,
        restoreTested: false,
        schedule: "secret-value",
      }}
    />,
  );
  expect(screen.getByRole("region", { name: "Backup" }).textContent).not.toContain("secret-value");
});

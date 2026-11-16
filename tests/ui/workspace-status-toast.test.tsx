// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceStatusToast } from "../../apps/web/src/workspace/workspace-status-toast";

const record = { file: { updatedAt: "2026-11-08T12:00:00.000Z" } };
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("announces status changes, expires, and restarts the timer only for a new message", () => {
  const { rerender } = render(
    <WorkspaceStatusToast
      record={record}
      status="Save failed · Disk full"
      roomNotice={null}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("Save failed · Disk full");
  act(() => vi.advanceTimersByTime(3000));
  rerender(
    <WorkspaceStatusToast
      record={{ ...record }}
      status="Save failed · Disk full"
      roomNotice={null}
    />,
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByRole("status")).toBeNull();
  rerender(
    <WorkspaceStatusToast
      record={record}
      status="Save failed · Access denied"
      roomNotice={null}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("Save failed · Access denied");
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByRole("status")).toBeNull();
});

it("dismisses a failure and shows the next save failure", () => {
  const { rerender } = render(
    <WorkspaceStatusToast record={record} status="Save failed" roomNotice={null} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  expect(screen.queryByRole("status")).toBeNull();
  rerender(
    <WorkspaceStatusToast
      record={record}
      status="Save failed · Disk full"
      roomNotice={null}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Disk full",
  );
});

it("keeps sync retries available until resolved, then expires normally", () => {
  const retry = vi.fn();
  const { rerender } = render(
    <WorkspaceStatusToast
      record={record}
      status="Saved locally"
      roomNotice={null}
      retry={retry}
    />,
  );
  act(() => vi.advanceTimersByTime(30000));
  expect(
    screen.getByRole("status").querySelector("[data-state=error]"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
  expect(retry).toHaveBeenCalledOnce();
  rerender(
    <WorkspaceStatusToast
      record={record}
      status="Saved locally"
      roomNotice={null}
    />,
  );
  expect(screen.queryByRole("button", { name: "Retry sync" })).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByRole("status")).toBeNull();
});

it("hides empty statuses and clears pending timers on unmount", () => {
  const { unmount } = render(
    <WorkspaceStatusToast record={record} status="" roomNotice={null} />,
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["Saved on this device", "Saved to SuiteDrive", "Saved to file", "Saving…", "Saving to SuiteDrive…", "Editing", "Saved on this device · not yet on SuiteDrive"])("does not toast for %s or routine room notices", status => {
  render(<WorkspaceStatusToast record={record} status={status} roomNotice="Reconnected to the room." />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

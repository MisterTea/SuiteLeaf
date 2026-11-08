// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StatusIcon, saveIconState } from "../../apps/web/src/status-icon";
import { ServerStatusIcon } from "../../apps/web/src/drive/server-status";

afterEach(cleanup);

it.each([
  ["Saved on this device", "saved"],
  ["Draft saved · choose Save As", "saved"],
  ["Saved to SuiteDrive", "connected"],
  ["Saving…", "busy"],
  ["Saving to SuiteDrive…", "busy"],
  ["Unsaved changes", "editing"],
  ["Editing", "editing"],
  ["Saved on this device · not yet on SuiteDrive", "pending"],
  ["Saved on this device · offline", "offline"],
  ["Saved on this device · sign in to sync with SuiteDrive", "offline"],
  ["Save failed · Disk full", "error"],
  ["SuiteDrive has a newer version", "error"],
  ["Saved on this device · SuiteDrive rejected the upload", "error"],
  ["Downloaded “Plan.sldoc”", "downloaded"],
  ["Sam updated this.", "notice"],
] as const)(
  "represents %s with the %s icon and preserves its accessible label",
  (label, state) => {
    expect(saveIconState(label)).toBe(state);
    const { container } = render(<StatusIcon state={state} label={label} />);
    const icon = screen.getByTitle(label);
    expect(icon.dataset.state).toBe(state);
    expect(icon.textContent).toBe(label);
    expect(icon.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".status-icon-label")?.textContent).toBe(
      label,
    );
    expect(icon.tabIndex).toBe(0);
  },
);

it("includes saved revision details in the tooltip", () => {
  render(
    <StatusIcon
      state="connected"
      label="Saved to SuiteDrive"
      detail="revision · drive.example"
    />,
  );
  expect(
    screen.getByTitle("Saved to SuiteDrive · revision · drive.example"),
  ).toBeTruthy();
});

it("updates the server icon as reachability and replication change", () => {
  const { rerender } = render(
    <ServerStatusIcon sync={null} host="drive.example" />,
  );
  expect(
    screen.getByTitle("SuiteDrive is unavailable · drive.example").dataset
      .state,
  ).toBe("offline");
  rerender(
    <ServerStatusIcon
      sync={{ peers: 0, replicating: 0, heads: "" }}
      host="drive.example"
    />,
  );
  expect(
    screen.getByTitle("SuiteDrive is reachable · drive.example").dataset.state,
  ).toBe("connected");
  rerender(
    <ServerStatusIcon
      sync={{ peers: 1, replicating: 2, heads: "" }}
      host="drive.example"
    />,
  );
  expect(
    screen.getByTitle("Copying 2 files from other servers… · drive.example")
      .dataset.state,
  ).toBe("busy");
  expect(screen.getByRole("status").textContent).toBe(
    "Copying 2 files from other servers…",
  );
});


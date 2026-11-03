// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SessionList } from "../../apps/web/src/drive/session-list";

afterEach(cleanup);

it("names this device, signs out the other one, and hides the token", async () => {
  let ended = "";
  let reauth = "";
  render(
    <SessionList
      sessions={[
        { id: "secret-value", userAgent: "Garden browser", current: true },
        { id: "phone", userAgent: "Lost phone", current: false },
      ]}
      onRotate={async () => "secret-value"}
      onEnd={async (id) => {
        ended = id;
      }}
      onReauth={async (id) => {
        reauth = id;
      }}
    />,
  );
  const region = screen.getByRole("region", { name: "Sessions" });
  expect(region.textContent).toContain("Garden browser");
  expect(region.textContent).toContain("This device.");
  expect(region.textContent).toContain("Lost phone");
  expect(region.textContent).not.toContain("secret-value");
  fireEvent.click(screen.getByRole("button", { name: "Rotate Garden browser" }));
  const status = await screen.findByRole("status");
  expect(status.textContent).toContain("The new token is not shown here.");
  expect(status.textContent).not.toContain("secret-value");
  fireEvent.click(screen.getByRole("button", { name: "Ask Garden browser to sign in again" }));
  expect(reauth).toBe("secret-value");
  expect((await screen.findByText("That device must sign in again.")).textContent).toBe(
    "That device must sign in again.",
  );
  expect(screen.getByRole("region", { name: "Sessions" }).textContent).not.toContain("secret-value");
  fireEvent.click(screen.getByRole("button", { name: "Sign out Lost phone" }));
  expect(ended).toBe("phone");
  expect(screen.queryByRole("button", { name: "Sign out Garden browser" })).toBeNull();
});

it("says whether a device is inside the idle limit without showing the time", () => {
  render(
    <SessionList
      sessions={[
        {
          id: "phone",
          userAgent: "Lost phone",
          current: false,
          updatedAt: "secret-value",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        {
          id: "garden",
          userAgent: "Garden browser",
          current: true,
          updatedAt: "2026-11-01T12:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        {
          id: "desk",
          userAgent: "Desk",
          current: false,
          reauth: true,
          updatedAt: "2026-11-01T12:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ]}
      activity={{ now: "2026-11-01T12:10:00.000Z", idleSecs: 1800 }}
      onRotate={async () => undefined}
      onEnd={async () => undefined}
    />,
  );
  const region = screen.getByRole("region", { name: "Sessions" });
  expect(region.textContent).toContain("Lost phone");
  expect(region.textContent).toContain("This device is idle.");
  expect(region.textContent).toContain("Garden browser");
  expect(region.textContent).toContain("This device is signed in.");
  expect(region.textContent).toContain("Desk");
  expect(region.textContent).toContain("This device must sign in again.");
  expect(region.textContent).not.toContain("secret-value");
  expect(region.textContent).not.toContain("2026-11-01");
});

it("signs out a lost device by name and does not repeat that name", async () => {
  const named: string[] = [];
  render(
    <SessionList
      sessions={[{ id: "phone", userAgent: "Lost phone", current: false }]}
      onRotate={async () => undefined}
      onEnd={async () => undefined}
      onLostDevice={async (device) => {
        named.push(device);
        if (!device.trim()) throw new Error("Name the device to sign out.");
        return device === "Lost phone" ? 1 : 0;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign out that device" }));
  expect(await screen.findByText("Name the device to sign out.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Lost device name"), { target: { value: "secret-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign out that device" }));
  expect(named).toContain("secret-value");
  expect(await screen.findByText("No session uses that device name.")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Sessions" }).textContent).not.toContain("secret-value");
  fireEvent.change(screen.getByLabelText("Lost device name"), { target: { value: "Lost phone" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign out that device" }));
  expect(await screen.findByText("That device was signed out.")).toBeTruthy();
  expect(named.at(-1)).toBe("Lost phone");
});

it("does not show a device name that breaks across lines", () => {
  const sessions = [{ id: "phone", userAgent: "Garden\nsecret-value", current: false }];
  render(
    <SessionList
      sessions={sessions}
      onRotate={async () => undefined}
      onEnd={async () => undefined}
    />,
  );
  const region = screen.getByRole("region", { name: "Sessions" });
  expect(region.textContent).toContain("Unnamed device");
  expect(region.textContent).not.toContain("secret-value");
  expect(sessions[0]?.userAgent).toBe("Garden\nsecret-value");
});

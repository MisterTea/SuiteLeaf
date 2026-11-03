// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { queryDocument } from "@suiteleaf/core";
import { QuerySchedule } from "../../apps/web/src/editors/query-schedule";

afterEach(cleanup);

it("does not fetch a source address that includes a credential", async () => {
  const fetchRows = vi.fn();
  const remember = vi.fn();
  render(<QuerySchedule document={queryDocument([])} fetchRows={fetchRows} onRemember={remember} />);
  await userEvent.type(screen.getByLabelText("Source address"), "https://example.test?token=secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Refresh on a schedule" }));
  await vi.waitFor(() =>
    expect(screen.getByText("The source address cannot include a credential.")).toBeTruthy(),
  );
  expect(fetchRows).not.toHaveBeenCalled();
  const note = screen.getByText("The source address cannot include a credential.");
  expect(note.textContent).not.toContain("secret-value");
  expect(note.textContent).not.toContain("example.test");
  expect(remember).not.toHaveBeenCalled();
});

it("fills the saved wait and stores it when the schedule starts", async () => {
  const remember = vi.fn();
  const forget = vi.fn();
  const fetchRows = vi.fn(async () => ({ ok: true, rows: [] }));
  render(
    <QuerySchedule
      document={queryDocument([])}
      fetchRows={fetchRows}
      initial={{ everyMinutes: 15, source: "https://example.test/rows.json" }}
      onRemember={remember}
      onForget={forget}
    />,
  );
  expect((screen.getByLabelText("Source address") as HTMLInputElement).value).toBe(
    "https://example.test/rows.json",
  );
  expect((screen.getByLabelText("Refresh minutes") as HTMLInputElement).value).toBe("15");
  expect(fetchRows).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Refresh on a schedule" }));
  expect(remember).toHaveBeenCalledWith(15, "https://example.test/rows.json");
  await userEvent.click(screen.getByRole("button", { name: "Stop scheduled refresh" }));
  expect(forget).toHaveBeenCalledOnce();
});

it("refreshes once the wait has passed and does not repeat the rows", async () => {
  const times = ["2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "2026-11-01T00:01:00.000Z"];
  const fetchRows = vi.fn(async () => ({ ok: true, rows: [["secret-value"]] }));
  const rows: string[] = [];
  render(
    <QuerySchedule
      document={queryDocument([])}
      fetchRows={fetchRows}
      clock={() => times.shift() ?? times[times.length - 1] ?? ""}
      onRows={(loaded) => {
        rows.push(...loaded.map((row) => Object.values(row).join("")));
      }}
    />,
  );
  const ticks: Array<() => Promise<void>> = [];
  vi.spyOn(window, "setInterval").mockImplementation((handler) => {
    ticks.push(handler as () => Promise<void>);
    return 1;
  });
  await userEvent.clear(screen.getByLabelText("Refresh minutes"));
  await userEvent.type(screen.getByLabelText("Refresh minutes"), "1");
  await userEvent.type(screen.getByLabelText("Source address"), "https://example.test/beds");
  await userEvent.click(screen.getByRole("button", { name: "Refresh on a schedule" }));
  await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
  await ticks[0]?.();
  expect(fetchRows).toHaveBeenCalledTimes(1);
  await ticks[0]?.();
  await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
  expect(screen.getByText("The source was refreshed.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret-value");
  expect(rows.join("")).toContain("secret-value");
});

it("sends a source token on the request and does not store it", async () => {
  const fetchRows = vi.fn(async () => ({ ok: true, rows: [] }));
  const remember = vi.fn();
  vi.spyOn(window, "setInterval").mockImplementation(() => 1);
  render(<QuerySchedule document={queryDocument([])} fetchRows={fetchRows} onRemember={remember} />);
  await userEvent.type(screen.getByLabelText("Source address"), "https://example.test/beds");
  await userEvent.type(screen.getByLabelText("Source token"), "secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Refresh on a schedule" }));
  await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledWith("https://example.test/beds", "secret-value"));
  expect(remember).toHaveBeenCalledWith(1, "https://example.test/beds");
  expect(JSON.stringify(remember.mock.calls)).not.toContain("secret-value");
  expect(screen.getByText("The source was refreshed.").textContent).not.toContain("secret-value");
});

it("does not write rows that arrive after the schedule stops", async () => {
  let finish: (table: { ok: boolean; rows: string[][] }) => void = () => undefined;
  const fetchRows = vi.fn(
    () =>
      new Promise<{ ok: boolean; rows: string[][] }>((resolve) => {
        finish = resolve;
      }),
  );
  const written: string[] = [];
  vi.spyOn(window, "setInterval").mockImplementation(() => 1);
  render(
    <QuerySchedule
      document={queryDocument([])}
      fetchRows={fetchRows}
      onRows={(rows) => {
        written.push(JSON.stringify(rows));
      }}
    />,
  );
  await userEvent.type(screen.getByLabelText("Source address"), "https://example.test/beds");
  await userEvent.click(screen.getByRole("button", { name: "Refresh on a schedule" }));
  await vi.waitFor(() => expect(fetchRows).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "Stop scheduled refresh" }));
  finish({ ok: true, rows: [["secret-value"]] });
  await vi.waitFor(() => expect(screen.getByText("The scheduled refresh is stopped.")).toBeTruthy());
  expect(written).toEqual([]);
  expect(screen.getByText("The scheduled refresh is stopped.").textContent).not.toContain("secret-value");
});

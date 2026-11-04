// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryDocument } from "@suiteleaf/core";
import { QuerySchedule } from "../../apps/web/src/editors/query-schedule";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function start(address: string, minutes = "5") {
  fireEvent.change(screen.getByLabelText("Source address"), { target: { value: address } });
  fireEvent.change(screen.getByLabelText("Refresh minutes"), { target: { value: minutes } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh on a schedule" }));
}

describe("refreshing a query source on a timer", () => {
  it("fetches the rows itself with the token, keeping only text cells", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ rows: [{ Plot: "North", Beds: 3 }, "loose", [1, 2], null, { Plot: "South" }] }),
    }));
    vi.stubGlobal("fetch", fetch);
    const onRows = vi.fn(() => "Wrote 2 rows.");
    render(<QuerySchedule document={queryDocument([])} onRows={onRows} />);
    fireEvent.change(screen.getByLabelText("Source token"), { target: { value: "tok\r\nen" } });
    expect(screen.getByLabelText("Source token")).toHaveProperty("value", "token");
    start("https://example.test/rows.json");
    await waitFor(() => expect(screen.getByText("Wrote 2 rows.")).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith("https://example.test/rows.json", { headers: { Authorization: "Bearer token" } });
    expect(onRows).toHaveBeenCalledWith([{ Plot: "North" }, { Plot: "South" }]);
  });

  it("fetches without a token header, and says when the source refused", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetch);
    render(<QuerySchedule document={queryDocument([])} />);
    start("https://example.test/rows.json");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("https://example.test/rows.json", undefined));
    expect(await screen.findByText("The source did not answer.")).toBeTruthy();
  });

  it("says the source was refreshed when the rows were not written anywhere", async () => {
    render(<QuerySchedule document={queryDocument([])} fetchRows={async () => ({ ok: true })} />);
    start("https://example.test/rows.json");
    expect(await screen.findByText("The source was refreshed.")).toBeTruthy();
  });

  it("passes a failed fetch on as a note", async () => {
    const fetchRows = vi.fn(async (_url: string, authorization?: string) => {
      expect(authorization).toBe("abc");
      return { ok: false };
    });
    render(<QuerySchedule document={queryDocument([])} fetchRows={fetchRows} />);
    fireEvent.change(screen.getByLabelText("Source token"), { target: { value: "abc" } });
    start("https://example.test/rows.json");
    expect(await screen.findByText("The source did not answer.")).toBeTruthy();
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it("asks for whole minutes", () => {
    const fetchRows = vi.fn();
    render(<QuerySchedule fetchRows={fetchRows} />);
    for (const minutes of ["0", "1.5", "2000", "soon"]) {
      start("https://example.test/rows.json", minutes);
      expect(screen.getByText("Name the wait in whole minutes.")).toBeTruthy();
    }
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("restarts the timer when started again and stops it on leaving", async () => {
    let next = 100;
    vi.spyOn(window, "setInterval").mockImplementation((() => ++next) as unknown as typeof window.setInterval);
    const clear = vi.spyOn(window, "clearInterval").mockImplementation(() => {});
    const fetchRows = vi.fn(async () => ({ ok: true, rows: [] }));
    const { unmount } = render(<QuerySchedule fetchRows={fetchRows} />);
    start("https://example.test/rows.json");
    start("https://example.test/rows.json");
    expect(clear.mock.calls).toEqual([[101]]);
    unmount();
    expect(clear.mock.calls).toEqual([[101], [102]]);
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });

  it("ignores a refresh that finishes after the schedule was stopped", async () => {
    let finish: (value: { ok: boolean; rows: never[] }) => void = () => {};
    const onRows = vi.fn();
    render(<QuerySchedule fetchRows={() => new Promise((resolve) => (finish = resolve))} onRows={onRows} />);
    start("https://example.test/rows.json");
    fireEvent.click(screen.getByRole("button", { name: "Stop scheduled refresh" }));
    finish({ ok: true, rows: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onRows).not.toHaveBeenCalled();
    expect(screen.getByText("The scheduled refresh is stopped.")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComboPreview } from "../../apps/web/src/editors/combo-chart";
import { WaterfallPreview } from "../../apps/web/src/editors/waterfall-chart";
import { HistogramPreview } from "../../apps/web/src/editors/histogram-chart";
import { StackedPreview } from "../../apps/web/src/editors/stacked-chart";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The editor draws each preview inside a sized container. */
const sized = (chart: ReactNode) =>
  render(
    <ResponsiveContainer width={480} height={320}>
      {chart as never}
    </ResponsiveContainer>,
  );

const legend = (container: HTMLElement) =>
  [...container.querySelectorAll(".recharts-legend-item-text")].map((node) => node.textContent).sort();

describe("chart previews in a spreadsheet", () => {
  const rows = [
    { label: "Jan", dues: 40, compost: 15, members: 12 },
    { label: "Feb", dues: 10, compost: 5, members: 14 },
  ];
  const colors = ["#111111", "#222222"];

  it("draws a combo chart with columns and the last series as a line", () => {
    const { container } = sized(
      <ComboPreview rows={rows} keys={["dues", "compost", "members"]} headers={["Month", "Dues", "Compost", "Members"]} colors={colors} />,
    );
    expect(legend(container)).toEqual(["Compost", "Dues", "Members"]);
    expect(container.querySelectorAll(".recharts-line")).toHaveLength(1);
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(2);
    expect(container.querySelectorAll(".recharts-yAxis")).toHaveLength(2);
  });

  it("draws one series as columns only, named by its key without a header", () => {
    const { container } = sized(<ComboPreview rows={rows} keys={["dues"]} headers={["Month"]} colors={colors} />);
    expect(legend(container)).toEqual(["dues"]);
    expect(container.querySelectorAll(".recharts-line")).toHaveLength(0);
    expect(container.querySelectorAll(".recharts-yAxis")).toHaveLength(1);
  });

  it("stacks every series and says how many cells were text", () => {
    const { container } = sized(
      <StackedPreview rows={rows} keys={["dues", "compost"]} headers={["Month", "Dues"]} colors={colors} cells={[1, "n/a", 2]} />,
    );
    expect(legend(container)).toEqual(["Dues", "compost"].sort());
    expect(screen.getByText("1 value was not a number.")).toBeTruthy();
  });

  it("counts numbers into bins and notes the skipped text", () => {
    const { container } = sized(<HistogramPreview cells={[1, 2, 3, 8, 9, "x"]} bins={2} />);
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);
    expect(screen.getByText("1 value was not a number.")).toBeTruthy();
  });

  it("hangs each fall from the running total in a waterfall", () => {
    const { container } = sized(
      <WaterfallPreview
        rows={[
          { label: "Start", change: 100 },
          { label: "Seeds", change: -30 },
          { label: "Grant", change: 50 },
          { label: "Note", change: "later" },
        ]}
      />,
    );
    expect(legend(container)).toEqual(["Fall", "Rise", "Total"]);
    expect(container.textContent).toMatch(/-30|−30/);
    expect(screen.getByText("1 change was not a number.")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { SheetGoalPanel } from "../../apps/web/src/editors/sheet-goal-panel";

afterEach(cleanup);

it("asks the solver for a second input and does not repeat the formula", async () => {
  let solved = false;
  render(
    <SheetGoalPanel
      disabled={false}
      onSeek={async () => {
        throw new Error("secret-value");
      }}
      onSolve={async (input) => {
        solved = input.second === "C2" && input.secondLow === 0 && input.secondHigh === 10;
        return { message: "The search reached the target.", wrote: true };
      }}
    />,
  );
  expect(screen.getByRole("region", { name: "Goal Seek" }).textContent).not.toContain("This is not a Solver");
  await userEvent.type(screen.getByLabelText("Formula cell"), "B2");
  await userEvent.type(screen.getByLabelText("Goal target"), "10");
  await userEvent.clear(screen.getByLabelText("High guess"));
  await userEvent.type(screen.getByLabelText("High guess"), "10");
  await userEvent.type(screen.getByLabelText("Second input"), "C2");
  await userEvent.clear(screen.getByLabelText("Second high"));
  await userEvent.type(screen.getByLabelText("Second high"), "10");
  await userEvent.click(screen.getByRole("button", { name: "Solve" }));
  expect(solved).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("The search reached the target.");
  expect(document.body.textContent).not.toContain("secret-value");
});

it("asks the solver for a third input and does not repeat a bad address", async () => {
  let third = "";
  render(
    <SheetGoalPanel
      disabled={false}
      onSeek={async () => ({ message: "The search reached the target.", wrote: true })}
      onSolve={async (input) => {
        third = input.third ?? "";
        return { message: "The search reached the target.", wrote: true };
      }}
    />,
  );
  await userEvent.type(screen.getByLabelText("Formula cell"), "B2");
  await userEvent.type(screen.getByLabelText("Goal target"), "10");
  await userEvent.type(screen.getByLabelText("Third input"), "secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Solve" }));
  expect(screen.getByRole("status").textContent).toBe("Name the second input before the third.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
  await userEvent.type(screen.getByLabelText("Second input"), "C2");
  await userEvent.click(screen.getByRole("button", { name: "Solve" }));
  expect(screen.getByRole("status").textContent).toBe("Name the third input, such as D2.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
  expect(third).toBe("");
  await userEvent.clear(screen.getByLabelText("Third input"));
  await userEvent.type(screen.getByLabelText("Third input"), "D2");
  await userEvent.click(screen.getByRole("button", { name: "Solve" }));
  expect(third).toBe("D2");
  expect(screen.getByRole("status").textContent).toBe("The search reached the target.");
});

it("sends an at most limit and does not repeat a limit that is not a number", async () => {
  let limit: number | undefined;
  render(
    <SheetGoalPanel
      disabled={false}
      onSeek={async () => ({ message: "The search reached the target.", wrote: true })}
      onSolve={async (input) => {
        limit = input.atMost;
        return { message: "The search reached the target.", wrote: true };
      }}
    />,
  );
  await userEvent.type(screen.getByLabelText("Formula cell"), "B2");
  await userEvent.type(screen.getByLabelText("Goal target"), "9");
  await userEvent.type(screen.getByLabelText("At most"), "secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Seek" }));
  expect(screen.getByRole("status").textContent).toBe("The limit is not a number.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
  await userEvent.clear(screen.getByLabelText("At most"));
  await userEvent.type(screen.getByLabelText("At most"), "3");
  await userEvent.click(screen.getByRole("button", { name: "Seek" }));
  expect(screen.getByRole("status").textContent).toBe("Name a second input to use the limit.");
  await userEvent.type(screen.getByLabelText("Second input"), "C2");
  await userEvent.click(screen.getByRole("button", { name: "Solve" }));
  expect(limit).toBe(3);
  expect(screen.getByRole("status").textContent).toBe("The search reached the target.");
});

it("stops a search and leaves the target out of the stop sentence", async () => {
  let stopped = false;
  let release: (result: { message: string; wrote: boolean }) => void = () => undefined;
  render(
    <SheetGoalPanel
      disabled={false}
      onSeek={(input) =>
        new Promise((done) => {
          release = (result) => {
            stopped = input.shouldStop();
            done(result);
          };
        })
      }
    />,
  );
  await userEvent.type(screen.getByLabelText("Formula cell"), "B2");
  await userEvent.type(screen.getByLabelText("Goal target"), "10");
  await userEvent.click(screen.getByRole("button", { name: "Seek" }));
  await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
  release({ message: "The search stopped. The input cell was put back.", wrote: false });
  expect(stopped).toBe(true);
  expect(await screen.findByText("The search stopped. The input cell was put back.")).toBeTruthy();
  expect(screen.getByRole("status").textContent).not.toContain("B2");
});

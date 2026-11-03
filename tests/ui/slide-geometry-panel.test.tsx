// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SlideGeometryPanel } from "../../apps/web/src/editors/slide-geometry-panel";

afterEach(cleanup);

it("applies a typed position and leaves a locked box", () => {
  const calls: string[] = [];
  const { rerender } = render(
    <SlideGeometryPanel
      object={{ id: "title", x: 10, y: 20, width: 100, height: 40 }}
      onPlace={(id, next) => calls.push(`${id}:${next.x}`)}
      onClose={() => calls.push("close")}
    />,
  );
  fireEvent.change(screen.getByLabelText("Object x"), { target: { value: "80" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply position" }));
  expect(calls).toEqual(["title:80"]);
  expect(screen.getByRole("status").textContent).toBe("The position was applied.");
  rerender(
    <SlideGeometryPanel
      object={{ id: "title", x: 10, y: 20, width: 100, height: 40, locked: true }}
      onPlace={(id, next) => calls.push(`${id}:${next.x}`)}
      onClose={() => calls.push("close")}
    />,
  );
  fireEvent.change(screen.getByLabelText("Object x"), { target: { value: "secret-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply position" }));
  expect(calls).toEqual(["title:80"]);
  expect(screen.getByRole("status").textContent).toBe("That object is locked.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
  rerender(
    <SlideGeometryPanel
      object={{ id: "title", x: 10, y: 20, width: 100, height: 40, rotation: 15 }}
      onPlace={(id, next) => calls.push(`${id}:${next.rotation}`)}
      onClose={() => calls.push("close")}
    />,
  );
  expect((screen.getByLabelText("Object rotation") as HTMLInputElement).value).toBe("15");
  fireEvent.change(screen.getByLabelText("Object rotation"), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply position" }));
  expect(calls).toEqual(["title:80", "title:90"]);
  fireEvent.change(screen.getByLabelText("Object rotation"), { target: { value: "secret-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply position" }));
  expect(screen.getByRole("status").textContent).toBe("Enter a number for rotation.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
  expect(calls).toEqual(["title:80", "title:90"]);
});

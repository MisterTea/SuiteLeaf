// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InstallButton } from "../../apps/web/src/InstallButton";

afterEach(cleanup);

it("offers browser instructions when there is no native prompt", () => {
  render(<InstallButton />);
  const heading = screen.getByText("Install SuiteLeaf");
  const dialog = heading.closest("dialog")!;
  const showModal = vi.fn();
  Object.defineProperty(dialog, "showModal", { value: showModal });

  fireEvent.click(screen.getByRole("button", { name: "Install SuiteLeaf" }));

  expect(showModal).toHaveBeenCalledOnce();
});

it("uses an install prompt captured before rendering and hides the button after installation", () => {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    { prompt },
  );
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);

  render(<InstallButton />);
  fireEvent.click(screen.getByRole("button", { name: "Install SuiteLeaf" }));
  expect(prompt).toHaveBeenCalledOnce();

  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
  expect(
    screen.queryByRole("button", { name: "Install SuiteLeaf" }),
  ).toBeNull();
});

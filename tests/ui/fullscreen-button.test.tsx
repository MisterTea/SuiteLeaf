// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FullscreenButton } from "../../apps/web/src/workspace/fullscreen-button";

function fullscreen(element: Element | null) {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: element,
  });
  document.dispatchEvent(new Event("fullscreenchange"));
}

beforeEach(() => {
  fullscreen(null);
  vi.spyOn(document.documentElement, "requestFullscreen").mockImplementation(
    async () => {
      fullscreen(document.documentElement);
    },
  );
  vi.spyOn(document, "exitFullscreen").mockImplementation(async () =>
    fullscreen(null),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does not implement the Fullscreen API.
Object.defineProperty(document.documentElement, "requestFullscreen", {
  configurable: true,
  writable: true,
  value: async () => {},
});
Object.defineProperty(document, "exitFullscreen", {
  configurable: true,
  writable: true,
  value: async () => {},
});

it("enters fullscreen on the root and exits using the same button", async () => {
  render(<FullscreenButton />);
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  const exit = await screen.findByRole("button", { name: "Exit fullscreen" });
  await waitFor(() => expect(exit.disabled).toBe(false));
  expect(exit.getAttribute("aria-pressed")).toBe("true");
  expect(document.documentElement.requestFullscreen).toHaveBeenCalledOnce();
  fireEvent.click(exit);
  await waitFor(() => expect(screen.getByRole("button").disabled).toBe(false));
  expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  expect(document.exitFullscreen).toHaveBeenCalledOnce();
});

it("reflects existing fullscreen and Escape or external fullscreen changes", () => {
  fullscreen(document.documentElement);
  const { unmount } = render(<FullscreenButton />);
  expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeTruthy();
  act(() => fullscreen(null));
  expect(screen.getByRole("button", { name: "Enter fullscreen" })).toBeTruthy();
  const remove = vi.spyOn(document, "removeEventListener");
  unmount();
  expect(remove).toHaveBeenCalledWith("fullscreenchange", expect.any(Function));
});

it("disables the button while a request is pending", async () => {
  let resolve!: () => void;
  vi.mocked(document.documentElement.requestFullscreen).mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(<FullscreenButton />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button").disabled).toBe(true);
  await act(async () => resolve());
  expect(screen.getByRole("button").disabled).toBe(false);
});

it.each(["request", "exit"])(
  "handles a rejected %s and allows retrying",
  async (method) => {
    if (method === "exit") fullscreen(document.documentElement);
    const api =
      method === "exit"
        ? document.exitFullscreen
        : document.documentElement.requestFullscreen;
    vi.mocked(api).mockRejectedValueOnce(new Error("Denied"));
    render(<FullscreenButton />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button").disabled).toBe(false);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  },
);

it.each(["request", "exit", "policy"])(
  "disables fullscreen when unavailable through %s",
  (reason) => {
    const target = reason === "request" ? document.documentElement : document;
    const property =
      reason === "request"
        ? "requestFullscreen"
        : reason === "exit"
          ? "exitFullscreen"
          : "fullscreenEnabled";
    const original = Object.getOwnPropertyDescriptor(target, property);
    Object.defineProperty(target, property, {
      configurable: true,
      value: reason === "policy" ? false : undefined,
    });
    try {
      render(<FullscreenButton />);
      expect(screen.getByRole("button").disabled).toBe(true);
      expect(screen.getByRole("button").title).toContain("unavailable");
    } finally {
      if (original) Object.defineProperty(target, property, original);
      else Reflect.deleteProperty(target, property);
    }
  },
);

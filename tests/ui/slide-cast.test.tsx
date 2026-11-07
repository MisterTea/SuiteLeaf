// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { choose, openSlides, press, setupSlidesDom, words } from "./slide-editor-harness";
import { CAST_NAMESPACE, frameAssembler, type CastFrame } from "../../apps/web/src/editors/slide-cast-protocol";

const sdk = vi.hoisted(() => {
  const session = { sendMessage: vi.fn(async () => {}) };
  const context = { requestSession: vi.fn(async () => {}), getCurrentSession: vi.fn(() => session as typeof session | null), endCurrentSession: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  return { session, context, load: vi.fn(async () => {}), configure: vi.fn(() => ({ context, event: "session" })) };
});
vi.mock("../../apps/web/src/editors/slide-cast-sdk", async (original) => ({
  ...await original<typeof import("../../apps/web/src/editors/slide-cast-sdk")>(),
  loadCastSdk: sdk.load,
  configureCast: sdk.configure,
}));
vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));
setupSlidesDom();
beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubEnv("VITE_SUITELEAF_CAST_APP_ID", "APP12345");
  sdk.load.mockReset().mockResolvedValue(undefined);
  sdk.configure.mockClear();
  sdk.context.requestSession.mockReset().mockResolvedValue(undefined);
  sdk.context.getCurrentSession.mockReset().mockReturnValue(sdk.session);
  sdk.context.endCurrentSession.mockClear();
  sdk.context.addEventListener.mockClear();
  sdk.context.removeEventListener.mockClear();
  sdk.session.sendMessage.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

const show = () => screen.getByRole("dialog", { name: "Slideshow" });
async function cast() {
  await waitFor(() => expect(sdk.configure).toHaveBeenCalledWith("APP12345"));
  choose("Slideshow options", "Cast…");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Slideshow" })).not.toBeNull());
  await waitFor(() => expect(sdk.session.sendMessage).toHaveBeenCalled());
}
function sent() {
  const frames: CastFrame[] = [];
  const receive = frameAssembler((frame) => frames.push(frame));
  for (const [namespace, chunk] of sdk.session.sendMessage.mock.calls as unknown as [string, unknown][]) {
    expect(namespace).toBe(CAST_NAMESPACE);
    receive(chunk);
  }
  return frames;
}

it("casts from the selected slide, keeps notes local, follows navigation and blanks, and stops on Exit", async () => {
  const editor = openSlides({ edit: (deck) => { deck.slides.b.notes = "Private speaker notes"; } });
  fireEvent.click(document.querySelector('.thumbnail-row[data-slide-id="b"]')!);
  await cast();
  expect(sdk.context.requestSession).toHaveBeenCalledTimes(1);
  expect(show().textContent).toContain("Private speaker notes");
  expect(sent().at(-1)?.index).toBe(1);
  expect(JSON.stringify(sent())).not.toContain("Private speaker notes");
  press("ArrowRight");
  await waitFor(() => expect(sent().at(-1)?.index).toBe(2));
  press("b");
  await waitFor(() => expect(sent().at(-1)?.blank).toBe("#000000"));
  press("w");
  await waitFor(() => expect(sent().at(-1)?.blank).toBe("#ffffff"));
  press("Escape");
  expect(sdk.context.endCurrentSession).toHaveBeenCalledWith(true);
  expect(screen.queryByRole("dialog", { name: "Slideshow" })).toBeNull();
  expect(editor.onChange).not.toHaveBeenCalled();
});

it("sends reveal steps for viewers and stops casting without closing presenter view", async () => {
  openSlides({ readOnly: true, slides: { a: [words("a", "Reveal me", { animation: "fade-on-click" })] } });
  await cast();
  expect(sent().at(-1)?.cursor.revealed).toBe(0);
  press("ArrowRight");
  await waitFor(() => expect(sent().at(-1)?.cursor.revealed).toBe(1));
  fireEvent.click(within(show()).getByRole("button", { name: "Stop casting" }));
  expect(sdk.context.endCurrentSession).toHaveBeenCalledTimes(1);
  expect(show()).toBeTruthy();
  expect(within(show()).queryByRole("button", { name: "Stop casting" })).toBeNull();
});

it.each(["cancel", "error", "missing"])("handles a %s session without starting the show", async (mode) => {
  if (mode === "missing") sdk.context.getCurrentSession.mockReturnValue(null);
  else sdk.context.requestSession.mockRejectedValueOnce(mode === "cancel" ? { code: "cancel" } : new Error("network"));
  openSlides();
  await waitFor(() => expect(sdk.configure).toHaveBeenCalled());
  choose("Slideshow options", "Cast…");
  await waitFor(() => expect(sdk.context.requestSession).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(screen.queryByRole("dialog", { name: "Slideshow" })).toBeNull();
  if (mode === "cancel") expect(screen.queryByRole("alert")).toBeNull();
  else expect(screen.getByRole("alert").textContent).toContain("Could not start casting");
});

it("explains missing configuration and SDK failure in the Cast menu", async () => {
  vi.stubEnv("VITE_SUITELEAF_CAST_APP_ID", "");
  const editor = openSlides();
  expect(sdk.load).not.toHaveBeenCalled();
  choose("Slideshow options", "Cast…");
  expect(screen.getByRole("menuitem", { name: /Cast/ }).getAttribute("aria-disabled")).toBe("true");
  expect(sdk.context.requestSession).not.toHaveBeenCalled();
  editor.unmount();
  vi.stubEnv("VITE_SUITELEAF_CAST_APP_ID", "APP12345");
  sdk.load.mockRejectedValueOnce(new Error("SDK unavailable"));
  openSlides();
  await act(async () => {});
  choose("Slideshow options", "Cast…");
  expect(screen.getByRole("menuitem", { name: /Cast/ }).getAttribute("aria-disabled")).toBe("true");
});

it("cleans up listeners and stops the receiver on editor unmount", async () => {
  const editor = openSlides();
  await cast();
  editor.unmount();
  expect(sdk.context.endCurrentSession).toHaveBeenCalledWith(true);
  expect(sdk.context.removeEventListener).toHaveBeenCalledWith("session", sdk.context.addEventListener.mock.calls[0][1]);
});

it("closes a session that finishes connecting after the editor unmounts", async () => {
  let resolve!: () => void;
  sdk.context.requestSession.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
  const editor = openSlides();
  await waitFor(() => expect(sdk.configure).toHaveBeenCalled());
  choose("Slideshow options", "Cast…");
  editor.unmount();
  await act(async () => resolve());
  expect(sdk.context.endCurrentSession).toHaveBeenCalledWith(true);
});

it("handles device disconnect while keeping presenter controls usable", async () => {
  openSlides();
  await cast();
  sdk.context.getCurrentSession.mockReturnValue(null);
  act(() => (sdk.context.addEventListener.mock.calls[0][1] as () => void)());
  expect(within(show()).queryByRole("button", { name: "Stop casting" })).toBeNull();
  expect(within(show()).getByRole("alert").textContent).toContain("disconnected");
  press("ArrowRight");
  expect(show().querySelector(".presenter-counter")?.textContent).toContain("Slide 2");
});

it("reports a transfer failure and stops its session", async () => {
  sdk.session.sendMessage.mockRejectedValueOnce(new Error("transport"));
  openSlides();
  await cast();
  await waitFor(() => expect(sdk.context.endCurrentSession).toHaveBeenCalledWith(true));
  expect(within(show()).getByRole("alert").textContent).toContain("could not be sent");
});

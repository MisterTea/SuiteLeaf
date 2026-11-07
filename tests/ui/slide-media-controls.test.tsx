// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SlideElement } from "../../packages/core/src";
import { SlideMediaControls } from "../../apps/web/src/editors/slide-media";

const clip: SlideElement = {
  id: "clip", type: "video", x: 0, y: 0, width: 100, height: 100,
  src: "clip.mp4",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("plays and stops from the icon button without advancing the slide", () => {
  const advance = vi.fn();
  const select = vi.fn();
  const { container } = render(
    <div onClick={advance} onMouseDown={select}><SlideMediaControls element={clip} /></div>,
  );
  const video = container.querySelector("video")!;
  let paused = true;
  Object.defineProperty(video, "paused", { get: () => paused });
  const play = vi.spyOn(video, "play").mockImplementation(() => {
    paused = false;
    fireEvent.play(video);
    return Promise.resolve();
  });
  const pause = vi.spyOn(video, "pause").mockImplementation(() => {
    paused = true;
    fireEvent.pause(video);
  });
  const button = screen.getByRole("button", { name: "Play video" });
  expect(button.textContent).toBe("");
  expect(button.querySelector("svg")).not.toBeNull();
  fireEvent.mouseDown(button);
  fireEvent.click(button);
  expect(play).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Stop video" }).title).toBe("Stop video");
  video.currentTime = 12;
  fireEvent.click(button);
  expect(pause).toHaveBeenCalledOnce();
  expect(video.currentTime).toBe(0);
  expect(screen.getByRole("button", { name: "Play video" })).toBe(button);
  fireEvent.click(button);
  expect(play).toHaveBeenCalledTimes(2);
  expect(advance).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it.each(["pause", "ended", "emptied"] as const)("restores the play icon on %s", (event) => {
  const { container } = render(<div><SlideMediaControls element={clip} /></div>);
  const video = container.querySelector("video")!;
  fireEvent.play(video);
  expect(screen.getByRole("button", { name: "Stop video" })).toBeTruthy();
  fireEvent[event](video);
  expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
});

it("keeps the play action when playback fails", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("unavailable"));
  render(<div><SlideMediaControls element={clip} /></div>);
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
  await Promise.resolve();
  expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
});

it("keeps the audio button and its playback", () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { container } = render(<div><SlideMediaControls element={{ ...clip, type: "audio" }} /></div>);
  fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
  expect(play).toHaveBeenCalledOnce();
  expect(container.querySelector("audio")).not.toBeNull();
});

it("ignores a control whose media has been removed", () => {
  const { container } = render(<div><SlideMediaControls element={clip} /></div>);
  container.querySelector("video")!.remove();
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
});

it.each(["data:video/mp4;base64,YQ==", "data:video/mp4,a", "data:,a"])("releases the playable blob for %s", (src) => {
  const create = vi.fn(() => "blob:clip");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const { container, unmount } = render(<div><SlideMediaControls element={{ ...clip, src }} /></div>);
  expect(container.querySelector("video")?.getAttribute("src")).toBe("blob:clip");
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:clip");
});

it.each([undefined, "data:invalid", "data:video/mp4;base64,!"])("tolerates an unavailable media source %s", (src) => {
  const { container } = render(<div><SlideMediaControls element={{ ...clip, src }} /></div>);
  expect(container.querySelector("video")?.getAttribute("src")).toBe(src ?? null);
});

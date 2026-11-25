// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SlideElement } from "../../packages/core/src";
import { SlideMediaControls } from "../../apps/web/src/editors/slide-media";

const clip: SlideElement = {
  id: "clip",
  type: "video",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  src: "clip.mp4",
  alt: "media1.mp4",
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not display the filename on videos, hides controls on play, and reveals them on tap", () => {
  vi.useFakeTimers();
  const advance = vi.fn();
  const select = vi.fn();
  const { container } = render(
    <div onClick={advance} onMouseDown={select}>
      <SlideMediaControls element={clip} />
    </div>,
  );
  // Filename is not rendered visually on the video
  expect(container.querySelector(".slide-media-name")).toBeNull();
  expect(container.textContent).not.toContain("media1.mp4");

  const video = container.querySelector("video")!;
  expect(video.getAttribute("aria-label")).toBe("media1.mp4");

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

  const controls = container.querySelector(".slide-video-controls")!;
  expect(controls.getAttribute("data-controls")).toBe("visible");

  const button = screen.getByRole("button", { name: "Play video" });
  expect(button.textContent).toBe("");
  expect(button.querySelector("svg")).not.toBeNull();

  // Start playback -> controls hide automatically
  fireEvent.mouseDown(button);
  fireEvent.click(button);
  expect(play).toHaveBeenCalledOnce();
  expect(controls.getAttribute("data-controls")).toBe("hidden");
  expect(controls.getAttribute("aria-hidden")).toBe("true");

  // Tap video while playing -> controls appear without advancing or selecting
  const tapLayer = container.querySelector(".slide-video-tap")!;
  expect(tapLayer).not.toBeNull();
  fireEvent.mouseDown(tapLayer);
  fireEvent.click(tapLayer);
  expect(controls.getAttribute("data-controls")).toBe("visible");
  const pauseBtn = screen.getByRole("button", { name: "Pause video" });
  expect(pauseBtn.title).toBe("Pause video");

  // Controls auto-hide after inactivity while playing
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(controls.getAttribute("data-controls")).toBe("hidden");

  // Tap again to show, then pause -> controls stay visible and time is preserved
  fireEvent.click(tapLayer);
  expect(controls.getAttribute("data-controls")).toBe("visible");
  video.currentTime = 12;
  fireEvent.click(screen.getByRole("button", { name: "Pause video" }));
  expect(pause).toHaveBeenCalledOnce();
  expect(video.currentTime).toBe(12);
  expect(controls.getAttribute("data-controls")).toBe("visible");
  expect(screen.getByRole("button", { name: "Play video" })).toBe(button);

  // Resume playback
  fireEvent.click(button);
  expect(play).toHaveBeenCalledTimes(2);
  expect(advance).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it.each(["pause", "ended", "emptied"] as const)("restores visible play controls on %s", (event) => {
  const { container } = render(
    <div>
      <SlideMediaControls element={clip} />
    </div>,
  );
  const video = container.querySelector("video")!;
  const controls = container.querySelector(".slide-video-controls")!;
  fireEvent.play(video);
  expect(controls.getAttribute("data-controls")).toBe("hidden");
  fireEvent[event](video);
  expect(controls.getAttribute("data-controls")).toBe("visible");
  expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
});

it("supports seeking and muting from the video control bar", () => {
  const { container } = render(
    <div>
      <SlideMediaControls element={clip} />
    </div>,
  );
  const video = container.querySelector("video")!;
  Object.defineProperty(video, "duration", { value: 60, configurable: true });
  fireEvent.loadedMetadata(video);

  const scrubber = screen.getByRole("slider", { name: "Seek video" }) as HTMLInputElement;
  expect(scrubber.disabled).toBe(false);
  fireEvent.change(scrubber, { target: { value: "25" } });
  expect(video.currentTime).toBe(25);

  const muteBtn = screen.getByRole("button", { name: "Mute video" });
  fireEvent.click(muteBtn);
  expect(video.muted).toBe(true);
  expect(screen.getByRole("button", { name: "Unmute video" })).toBeTruthy();
});

it("keeps the play action when playback fails", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("unavailable"));
  render(
    <div>
      <SlideMediaControls element={clip} />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
  await Promise.resolve();
  expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
});

it("keeps the audio button, filename, and playback", () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { container } = render(
    <div>
      <SlideMediaControls element={{ ...clip, type: "audio", alt: "quiet.wav" }} />
    </div>,
  );
  expect(container.querySelector(".slide-media-name")?.textContent).toBe("quiet.wav");
  fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
  expect(play).toHaveBeenCalledOnce();
  expect(container.querySelector("audio")).not.toBeNull();
});

it("ignores a control whose media has been removed", () => {
  const { container } = render(
    <div>
      <SlideMediaControls element={clip} />
    </div>,
  );
  container.querySelector("video")!.remove();
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
});

it.each(["data:video/mp4;base64,YQ==", "data:video/mp4,a", "data:,a"])("releases the playable blob for %s", (src) => {
  const create = vi.fn(() => "blob:clip");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const { container, unmount } = render(
    <div>
      <SlideMediaControls element={{ ...clip, src }} />
    </div>,
  );
  expect(container.querySelector("video")?.getAttribute("src")).toBe("blob:clip");
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:clip");
});

it.each([undefined, "data:invalid", "data:video/mp4;base64,!"])("tolerates an unavailable media source %s", (src) => {
  const { container } = render(
    <div>
      <SlideMediaControls element={{ ...clip, src }} />
    </div>,
  );
  expect(container.querySelector("video")?.getAttribute("src")).toBe(src ?? null);
});

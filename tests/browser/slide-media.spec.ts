import { expect, test, type Locator, type Page } from "@playwright/test";

const menuBar = (page: Page) => page.locator(".file-menu");

/** A short silent 8 kHz PCM WAV, about 8 KB. */
function silentWav(seconds = 0.5, sampleRate = 8000): Buffer {
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

/** 8×8 VP8 WebM, about 0.3s, generated without a runtime dependency. */
const TINY_WEBM = Buffer.from(
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAKxEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEyTbuMU6uEHFO7a1OsggKb7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjMuMS4xMDFXQYxMYXZmNjMuMS4xMDFEiYhAdAAAAAAAABZUrmvXrgEAAAAAAABO14EBc8WItQ3gMGLoN0ycgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QCYloA4JCwgQi6gQiagQJVsIRVuYEBVe6BAOwBAAAAAAAAAgAAElTDZ/pzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYzLjEuMTAxc3PVY8CLY8WItQ3gMGLoN0xnyKBFo4dFTkNPREVSRIeTTGF2YzYzLjEuMTAxIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuMzIwMDAwMDAwAB9DtnVA5OeBAKOjgQAAgBACAJ0BKggACAAARwiFhYiZhIgCAgAMDWAA/v+rUICjmYEAKACxAQABEBQAGAAwP/QMAAAA/v+PvACjmYEAUACxAQABEBAAGAAwP/QMAAAA/v+rUICjmYEAeACxAQABEBAAGAAwP/QMAAAA/v+rUICjmYEAoACxAQABEBAAGAAwP/QMAAAA/v+rUICjmYEAyACxAQABEBAAGAAwP/QMAAAA/v+rUICjmYEA8ACxAQABEBAAGAAwP/QMAAAA/v+rUICjmIEBGACRAQABECQUYADA/9AwAAD+/u2uABxTu2uRu4+zgQC3iveBAfGCAbHwgQM=",
  "base64",
);

async function chooseMedia(
  page: Page,
  item: "Audio" | "Video",
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const chooser = page.waitForEvent("filechooser");
  await menuBar(page).getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  await (await chooser).setFiles(file);
}

async function expectPlaying(media: Locator) {
  await expect
    .poll(() =>
      media.evaluate(
        (el: HTMLMediaElement) => el.paused === false || el.currentTime > 0,
      ),
    )
    .toBe(true);
}

test("audio and video stay on the slide and the audio plays", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const title = `Club night ${Date.now().toString(36)}`;

  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await page.getByLabel("File title").fill(title);

  const onSlide = (kind: "audio" | "video") =>
    page.locator(`.slide-canvas [data-media="${kind}"]`);
  await expect(onSlide("audio")).toHaveCount(0);

  await chooseMedia(page, "Audio", {
    name: "quiet.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });
  const audio = onSlide("audio");
  await expect(audio).toBeVisible();
  await expect(audio).toContainText("quiet.wav");
  await expect(audio.getByRole("button", { name: "Play audio" })).toBeVisible();
  await expect(audio.locator("audio")).toHaveAttribute("src", /^data:audio\/wav;base64,/);
  await audio.getByRole("button", { name: "Play audio" }).click();
  await expectPlaying(audio.locator("audio"));

  const before = await audio.boundingBox();
  expect(before).not.toBeNull();
  const startX = await audio.getAttribute("data-x");
  const startY = await audio.getAttribute("data-y");
  const name = await audio.locator(".slide-media-name").boundingBox();
  expect(name).not.toBeNull();
  await page.mouse.move(name!.x + 16, name!.y + 6);
  await page.mouse.down();
  await page.mouse.move(name!.x + 16 + 120, name!.y + 6 - 50, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => audio.getAttribute("data-x")).not.toBe(startX);
  const after = await audio.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeGreaterThan(20);
  const movedX = await audio.getAttribute("data-x");
  const movedY = await audio.getAttribute("data-y");
  expect(movedX).not.toBe(startX);
  expect(movedY).not.toBe(startY);

  await chooseMedia(page, "Video", {
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: TINY_WEBM,
  });
  const video = onSlide("video");
  await expect(video).toBeVisible();
  await expect(video).toContainText("clip.webm");
  await expect(video.getByRole("button", { name: "Play video" })).toBeVisible();
  await expect(video.locator("video")).toHaveCount(1);
  await expect(video.locator("video")).toHaveAttribute("src", /^data:video\/webm;base64,/);

  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const show = page.locator(".presenter-overlay");
  await expect(show).toBeVisible();
  const showAudio = show.locator('[data-media="audio"]');
  await expect(showAudio).toContainText("quiet.wav");
  await expect(showAudio.getByRole("button", { name: "Play audio" })).toBeVisible();
  await showAudio.getByRole("button", { name: "Play audio" }).click();
  await expectPlaying(showAudio.locator("audio"));
  await expect(show.locator('[data-media="video"]')).toContainText("clip.webm");
  await expect(show.getByRole("button", { name: "Play video" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await expect(audio).toContainText("quiet.wav");
  await expect(video).toContainText("clip.webm");
  await expect(audio).toHaveAttribute("data-x", movedX!);
  await expect(audio).toHaveAttribute("data-y", movedY!);
  await expect(audio.locator("audio")).toHaveAttribute("src", /^data:audio\/wav;base64,/);
  await expect(video.locator("video")).toHaveAttribute("src", /^data:video\/webm;base64,/);
  await audio.getByRole("button", { name: "Play audio" }).click();
  await expectPlaying(audio.locator("audio"));

  await expect(page.getByRole("alert")).toHaveCount(0);
  await chooseMedia(page, "Audio", {
    name: "too-big.wav",
    mimeType: "audio/wav",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("smaller than 5 MB");
  await expect(onSlide("audio")).toHaveCount(1);
  await expect(onSlide("video")).toHaveCount(1);
  await expect(audio).toContainText("quiet.wav");
  expect(errors).toEqual([]);
});

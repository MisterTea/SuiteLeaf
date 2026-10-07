import { execSync, spawn } from "node:child_process";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const outputMp4 = process.argv[2] || "artifacts/recordings/google_slides_workflow.mp4";

  // Activate Google Chrome and select the Slides tab
  execSync(`osascript -e '
tell application "Google Chrome"
    activate
    repeat with w in windows
        set idx to 1
        repeat with t in tabs of w
            if URL of t contains "presentation" then
                set index of w to 1
                set active tab index of w to idx
                exit repeat
            end if
            set idx to idx + 1
        end repeat
    end repeat
end tell'`);

  await sleep(1000);

  // Start ffmpeg recording screen 2 cropped to Chrome window
  const ffmpegProc = spawn(
    "/opt/homebrew/bin/ffmpeg",
    [
      "-y",
      "-f", "avfoundation",
      "-framerate", "24",
      "-i", "2",
      "-vf", "crop=3456:1986:0:66,scale=1440:900",
      "-t", "10",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      outputMp4,
    ],
    {
      stdio: ["pipe", "inherit", "inherit"],
    }
  );

  await sleep(1000);

  // Perform workflow actions in Google Slides
  // 1. Select Slide 1
  execSync(`osascript -e 'tell application "System Events" to key code 126'`); // Up arrow
  await sleep(1500);

  // 2. Select Slide 2
  execSync(`osascript -e 'tell application "System Events" to key code 125'`); // Down arrow
  await sleep(1500);

  // 3. Start Slideshow: Cmd+Option+P or Cmd+Shift+Enter or click
  // In Google Slides, Present shortcut is Cmd+Enter or Cmd+Option+P or click Slideshow button
  // Let's press Cmd+Enter to present
  execSync(`osascript -e 'tell application "System Events" to keystroke return using {command down}'`);
  await sleep(2000);

  // Navigate in Slideshow
  execSync(`osascript -e 'tell application "System Events" to key code 126'`); // Previous slide
  await sleep(1000);
  execSync(`osascript -e 'tell application "System Events" to key code 125'`); // Next slide
  await sleep(1000);

  // Exit Slideshow
  execSync(`osascript -e 'tell application "System Events" to key code 53'`); // Escape
  await sleep(1000);

  try {
    ffmpegProc.stdin?.write("q");
    ffmpegProc.stdin?.end();
  } catch (e) {}

  await new Promise((resolve) => {
    ffmpegProc.on("close", resolve);
    setTimeout(() => {
      try {
        ffmpegProc.kill("SIGINT");
      } catch (e) {}
    }, 4000);
  });
  console.log(`Saved Google Slides video to ${outputMp4}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { execSync, spawn } from "node:child_process";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOsa(script: string) {
  return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: "utf8",
  });
}

function runClicker(args: string) {
  return execSync(`/tmp/clicker ${args}`, { encoding: "utf8" });
}

async function main() {
  const outputMp4 = process.argv[2] || "artifacts/recordings/google_docs_workflow.mp4";

  // 1. Activate Chrome and bring the Google Docs tab forward
  console.log("Activating Google Docs tab in Chrome...");
  runOsa(`
tell application "Google Chrome"
    activate
    repeat with w in windows
        set idx to 1
        repeat with t in tabs of w
            if URL of t contains "19rRjO4Y34D_vcBRMT8VrgS-NN07l8BxpALr5qNJ0YrY" then
                set index of w to 1
                set active tab index of w to idx
                exit repeat
            end if
            set idx to idx + 1
        end repeat
    end repeat
end tell`);

  await sleep(1500);

  // 2. Start ffmpeg recording Chrome window region
  // Bounds of Chrome: 0, 55, 1728, 960 (Retina: 3456 x 1920)
  console.log("Starting ffmpeg recording...");
  const ffmpegProc = spawn(
    "/opt/homebrew/bin/ffmpeg",
    [
      "-y",
      "-f", "avfoundation",
      "-framerate", "24",
      "-i", "2:none",
      "-vf", "crop=3456:1920:0:110,scale=1440:800",
      "-t", "18",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      outputMp4,
    ],
    {
      stdio: ["pipe", "inherit", "inherit"],
    }
  );

  await sleep(1000);

  // 3. Workflow actions in Google Docs
  // Click on the document body to focus
  runClicker("650 350");
  await sleep(600);

  // Select all and replace with clean baseline text
  runOsa(`
tell application "System Events"
    keystroke "a" using {command down}
    delay 0.3
    keystroke "Quarterly Report"
    key code 36 -- return
    keystroke "Project cedar is on schedule."
    key code 36
    keystroke "Project Cedar has two milestones."
    key code 36
    keystroke "Actions"
    key code 36
    keystroke "Review the draft."
    key code 36
    keystroke "Approve the draft."
    key code 36
end tell`);
  await sleep(1200);

  // Heading styling: go to top, select "Quarterly Report"
  runOsa(`
tell application "System Events"
    key code 126 using {command down} -- Cmd+Up (top of doc)
    delay 0.3
    key code 124 using {shift down, command down} -- Shift+Cmd+Right (select line)
end tell`);
  await sleep(1000);

  // Bold "Actions": navigate down
  runOsa(`
tell application "System Events"
    key code 125 -- down
    key code 125 -- down
    key code 125 -- down
    key code 124 using {shift down, command down} -- select "Actions"
    delay 0.2
    keystroke "b" using {command down} -- Bold
end tell`);
  await sleep(1000);

  // Open Find & Replace dialog: Cmd+Shift+H
  runOsa(`
tell application "System Events"
    keystroke "h" using {command down, shift down}
    delay 0.5
    keystroke "cedar"
    key code 48 -- tab to Replace with
    delay 0.2
    keystroke "Cedar 2.0"
end tell`);
  await sleep(2500);

  // Close Find & Replace
  runOsa(`tell application "System Events" to key code 53`); // Escape
  await sleep(1500);

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

  console.log(`Saved Google Docs video to ${outputMp4}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

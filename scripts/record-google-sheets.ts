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
  const outputMp4 =
    process.argv[2] || "artifacts/recordings/google_sheets_workflow.mp4";

  // 1. Activate Chrome and select the Google Sheets tab
  console.log("Activating Google Sheets tab in Chrome...");
  runOsa(`
tell application "Google Chrome"
    activate
    repeat with w in windows
        set n to count of tabs of w
        repeat with i from 1 to n
            set t to tab i of w
            if URL of t contains "1iX7R8yeE6JSjUMqCNqR2X9BHe8j28STGdJm264Dei5g" then
                set index of w to 1
                set active tab index of w to i
                exit repeat
            end if
        end repeat
    end repeat
end tell`);

  await sleep(1500);

  // 2. Start ffmpeg recording Chrome window region
  // Bounds of Chrome: 0, 33, 1728, 960 (Retina: 3456 x 1920)
  console.log("Starting ffmpeg recording...");
  const ffmpegProc = spawn(
    "/opt/homebrew/bin/ffmpeg",
    [
      "-y",
      "-f", "avfoundation",
      "-framerate", "24",
      "-i", "2:none",
      "-vf", "crop=3456:1920:0:66,scale=1440:800",
      "-t", "20",
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

  // 3. Workflow actions in Google Sheets
  // Select F1 via Name Box
  console.log("Navigating to F1...");
  runClicker("45 289");
  await sleep(300);
  runOsa(`tell application "System Events" to keystroke "F1" & return`);
  await sleep(500);

  // Type header "Spent %"
  console.log("Typing header Spent %...");
  runOsa(`tell application "System Events"
    keystroke "Spent %"
    key code 36 -- return
  end tell`);
  await sleep(600);

  // Type formula in F2: =C2/B2
  console.log("Entering formula =C2/B2 in F2...");
  runOsa(`tell application "System Events"
    keystroke "=C2/B2"
    key code 36 -- return
  end tell`);
  await sleep(600);

  // Type formula in F3: =C3/B3
  console.log("Entering formula =C3/B3 in F3...");
  runOsa(`tell application "System Events"
    keystroke "=C3/B3"
    key code 36 -- return
  end tell`);
  await sleep(600);

  // Select F2:F5 via Name Box
  console.log("Selecting F2:F5 for percent formatting...");
  runClicker("45 289");
  await sleep(300);
  runOsa(`tell application "System Events" to keystroke "F2:F5" & return`);
  await sleep(500);

  // Click Format as Percent (%) button: x=223, y=245
  console.log("Formatting as percent...");
  runClicker("223 245");
  await sleep(600);

  // Click Increase decimal (.00): x=260, y=245
  console.log("Increasing decimal...");
  runClicker("260 245");
  await sleep(500);

  // Click Decrease decimal (.0): x=241, y=245
  console.log("Decreasing decimal...");
  runClicker("241 245");
  await sleep(500);

  // Select A1:F1 via Name Box
  console.log("Selecting headers A1:F1 for bold and styling...");
  runClicker("45 289");
  await sleep(300);
  runOsa(`tell application "System Events" to keystroke "A1:F1" & return`);
  await sleep(500);

  // Click Bold (B): x=420, y=245
  console.log("Applying bold...");
  runClicker("420 245");
  await sleep(500);

  // Click Align button: x=568, y=245 -> center
  console.log("Applying center alignment...");
  runClicker("568 245");
  await sleep(400);
  runClicker("568 285");
  await sleep(500);

  // Click Fill color: x=500, y=245 -> pick light green swatch
  console.log("Applying fill color...");
  runClicker("500 245");
  await sleep(400);
  runClicker("500 320");
  await sleep(500);

  // Select A1:F6 via Name Box for borders
  console.log("Selecting A1:F6 for borders...");
  runClicker("45 289");
  await sleep(300);
  runOsa(`tell application "System Events" to keystroke "A1:F6" & return`);
  await sleep(500);

  // Click Borders dropdown: x=518, y=245 -> All borders
  console.log("Applying borders...");
  runClicker("518 245");
  await sleep(400);
  runClicker("518 285");
  await sleep(500);

  // Click Create filter button: x=722, y=245
  console.log("Updating filter...");
  runClicker("722 245");
  await sleep(1500);

  // Wait for ffmpeg to finish
  await new Promise((resolve) => {
    ffmpegProc.on("close", resolve);
    setTimeout(() => {
      try {
        ffmpegProc.kill("SIGINT");
      } catch (e) {}
    }, 4000);
  });

  console.log(`Google Sheets recording saved to: ${outputMp4}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

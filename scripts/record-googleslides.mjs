import { spawn, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const targetMp4 = resolve(rootDir, "test-results", "googleslides_presentation_workflow.mp4");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runOsa(script) {
  try {
    return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: "utf8",
    });
  } catch (e) {
    console.error("AppleScript error:", e.message);
    throw e;
  }
}

function runClicker(args) {
  try {
    return execSync(`/tmp/clicker ${args}`, { encoding: "utf8" });
  } catch (e) {
    console.error("Clicker error:", e.message);
    throw e;
  }
}

async function main() {
  console.log("1. Preparing Google Chrome with new presentation...");
  runOsa(`
    tell application "Google Chrome"
      activate
      set URL of active tab of front window to "https://slides.new"
    end tell
  `);
  
  // Wait for Google Slides to load initial canvas
  console.log("Waiting for Google Slides to load...");
  await sleep(4000);

  console.log("Starting ffmpeg screen recording on display index 2...");
  const ffmpegArgs = [
    "-y",
    "-f", "avfoundation",
    "-framerate", "30",
    "-i", "2:none",
    "-vf", "scale=1920:-2",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    targetMp4,
  ];

  const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Let ffmpeg start capturing initial state
  await sleep(2000);

  console.log("2. Dismissing template modal if present...");
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to key code 53
  `);
  await sleep(1500);

  console.log("3. Slide 1: Editing Title to 'Quarterly Performance'...");
  runClicker("940 500");
  await sleep(600);
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to keystroke "Quarterly Performance"
  `);
  await sleep(1500);

  console.log("4. Slide 1: Editing Subtitle to 'Executive Leadership Briefing - Q3 2026'...");
  runClicker("940 660");
  await sleep(600);
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to keystroke "Executive Leadership Briefing - Q3 2026"
  `);
  await sleep(1500);

  // Commit text by pressing escape
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to key code 53
  `);
  await sleep(800);

  console.log("5. Adding Slide 2 (Title & Body layout)...");
  runClicker("140 230");
  await sleep(2000);

  console.log("6. Slide 2: Editing Title to 'Key Highlights'...");
  runClicker("500 340");
  await sleep(600);
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to keystroke "Key Highlights"
  `);
  await sleep(1200);

  // Deselect title
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to key code 53
  `);
  await sleep(600);

  console.log("7. Slide 2: Editing Body text bullet points...");
  runClicker("500 480");
  await sleep(600);
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events"
      keystroke "• Revenue grew 24% YoY exceeding targets"
      key code 36
      keystroke "• Operating margins expanded by 340 bps"
      key code 36
      keystroke "• Net retention stabilized at 112%"
      key code 36
      keystroke "• Enterprise tier adoption up 45%"
    end tell
  `);
  await sleep(2000);

  // Deselect text box by clicking grey canvas margin
  runClicker("200 500");
  await sleep(1200);

  console.log("8. Changing slide layout via Slide -> Apply layout menu...");
  runClicker("230 205");
  await sleep(800);
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events"
      key code 124
      key code 124
    end tell
  `);
  await sleep(800);
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events"
      repeat 10 times
        key code 125
      end repeat
      key code 124
    end tell
  `);
  await sleep(2000);
  // Dismiss layout picker
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events"
      key code 53
      key code 53
    end tell
  `);
  await sleep(1000);

  console.log("9. Inserting rectangle shape and positioning on Slide 2...");
  runClicker("522 230");
  await sleep(800);
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events"
      key code 125
      key code 124
      key code 36
    end tell
  `);
  await sleep(800);
  // Drag to draw rectangle on canvas
  runClicker("1100 400 drag 1350 600");
  await sleep(2000);

  console.log("10. Editing Speaker Notes on Slide 2...");
  runClicker("250 960");
  await sleep(800);
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to keystroke "Present revenue growth metrics and outline next steps for leadership team."
  `);
  await sleep(2000);

  console.log("11. Selecting Slide 1 before presentation mode...");
  runClicker("70 300");
  await sleep(1500);

  console.log("12. Starting fullscreen Slideshow mode...");
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to keystroke return using {command down}
  `);
  await sleep(4000);

  console.log("13. Advancing Slideshow to Slide 2...");
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to key code 124
  `);
  await sleep(4000);

  console.log("14. Exiting Slideshow mode...");
  runOsa(`
    tell application "Google Chrome" to activate
    tell application "System Events" to key code 53
  `);
  await sleep(3000);

  console.log("Finalizing video capture...");
  ffmpegProc.stdin.write("q");
  ffmpegProc.stdin.end();

  await new Promise((resolve) => {
    ffmpegProc.on("close", resolve);
    setTimeout(() => {
      try {
        ffmpegProc.kill("SIGINT");
      } catch (e) {}
    }, 5000);
  });

  console.log("Google Slides workflow MP4 saved at:", targetMp4);
}

main().catch((e) => {
  console.error("Execution failed:", e);
  process.exit(1);
});

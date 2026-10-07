import { spawn, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const targetMp4 = resolve(rootDir, "test-results", "powerpoint_presentation_workflow.mp4");

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

async function main() {
  console.log("Preparing PowerPoint...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      activate
      repeat while (count of presentations) > 0
        close presentation 1 saving no
      end repeat
    end tell
  `);
  await sleep(1500);

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

  console.log("1. Creating new presentation with Slide 1 in PowerPoint...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      activate
      make new presentation
      if (count of windows) > 0 then
        set bounds of window 1 to {0, 25, 1920, 1080}
      end if
      make new slide at end of active presentation with properties {layout:slide layout title slide}
    end tell
  `);
  await sleep(2500);

  console.log("2. Editing slide 1 title to 'Quarterly Performance'...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      set s1 to slide 1 of active presentation
      set content of text range of text frame of shape 1 of s1 to "Quarterly Performance"
      set content of text range of text frame of shape 2 of s1 to "Executive Leadership Briefing - Q3 2026"
    end tell
  `);
  await sleep(2500);

  console.log("3. Adding Slide 2 with Title & Content layout...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      make new slide at end of active presentation with properties {layout:slide layout text slide}
    end tell
  `);
  await sleep(2500);

  console.log("4. Editing Slide 2 title and bullet points...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      set s2 to slide 2 of active presentation
      set content of text range of text frame of shape 1 of s2 to "Key Highlights"
      set content of text range of text frame of shape 2 of s2 to "Revenue grew 24% YoY exceeding targets
Operating margins expanded by 340 bps
Net retention stabilized at 112%
Enterprise tier adoption up 45%"
      set layout of s2 to slide layout text slide
    end tell
  `);
  await sleep(2500);

  console.log("5. Inserting rectangle shape on Slide 2...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      set s2 to slide 2 of active presentation
      make new shape at s2 with properties {auto shape type:autoshape rectangle, left position:460, top:180, width:260, height:150}
    end tell
  `);
  await sleep(2500);

  console.log("6. Editing speaker notes on Slide 2...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      set s2 to slide 2 of active presentation
      set np to notes page of s2
      set content of text range of text frame of shape 2 of np to "Present revenue growth metrics"
    end tell
  `);
  await sleep(2500);

  console.log("Selecting Slide 1 before presentation mode...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      select slide 1 of active presentation
    end tell
  `);
  await sleep(2000);

  console.log("7. Starting fullscreen slide show...");
  runOsa(`
    tell application "Microsoft PowerPoint"
      run slide show (slide show settings of active presentation)
    end tell
  `);
  await sleep(3500);

  console.log("8. Advancing slide show to Slide 2...");
  runOsa(`
    tell application "System Events"
      key code 124
    end tell
  `);
  await sleep(3500);

  console.log("9. Exiting slide show presentation mode...");
  runOsa(`
    tell application "System Events"
      key code 53
    end tell
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

  console.log("PowerPoint workflow MP4 saved at:", targetMp4);
}

main().catch((e) => {
  console.error("Execution failed:", e);
  process.exit(1);
});

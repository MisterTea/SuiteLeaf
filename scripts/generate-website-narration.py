#!/usr/bin/env python3
"""
Parse all SuiteLeaf storyboards, build concise natural narration scripts,
generate neural voiceover MP3 + WebVTT captions via edge-tts, and write
website/data/storyboards.json.
"""

import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
STORYBOARDS_DIR = ROOT / "storyboards"
VIDEOS_DIR = STORYBOARDS_DIR / "videos"
WEBSITE_DIR = ROOT / "website"
NARRATION_DIR = WEBSITE_DIR / "narration"
DATA_DIR = WEBSITE_DIR / "data"

VOICE = "en-US-AndrewNeural"
CONCURRENCY = 10

ACCOUNT_SETUP_SCRIPT = (
    "Setting up a SuiteLeaf account takes less than a minute, and your existing local files stay safe on your device. "
    "From your workspace home screen, click Connect to a server in the sidebar. "
    "Enter the address of your team's SuiteLeaf server—you don't even need to type https—and click Connect. "
    "SuiteLeaf opens the sign-in screen for that server. Click Create an account, enter your name, email address, and password, and submit. "
    "You land right in your team workspace with SuiteDrive ready for shared documents, spreadsheets, and presentations, "
    "while everything on your computer remains untouched whenever you disconnect."
)


def strip_md(text: str) -> str:
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)
    text = text.replace("→", " to ").replace("·", ", ").replace("—", ", ").replace("–", " to ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def probe_duration(video_path: Path) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return round(float(out), 2)
    except Exception:
        return 20.0


def normalize_app_category(raw_app: str) -> str:
    lower = raw_app.lower()
    if "doc" in lower:
        return "Docs"
    if "sheet" in lower:
        return "Sheets"
    if "slide" in lower:
        return "Slides"
    if "form" in lower:
        return "Forms"
    if "file" in lower or "drive" in lower:
        return "Files"
    if "admin" in lower:
        return "Admin"
    if "home" in lower:
        return "Home"
    return raw_app.split(",")[0].strip() or "Docs"


def parse_storyboard(md_path: Path) -> dict | None:
    text = md_path.read_text(encoding="utf-8")
    slug = md_path.stem
    num_match = re.match(r"^(\d+)-", slug)
    num = int(num_match.group(1)) if num_match else 0

    # Title
    title_match = re.search(r"^#\s+(?:\d+\s*[·\-–:]\s*)?(.+)$", text, re.MULTILINE)
    title = strip_md(title_match.group(1)) if title_match else slug

    # Header metadata
    mode_match = re.search(r"\*\*Mode:\*\*\s*([^·\n]+)", text)
    mode = strip_md(mode_match.group(1)) if mode_match else "single-node"

    app_match = re.search(r"\*\*App:\*\*\s*([^·\n]+)", text)
    raw_app = strip_md(app_match.group(1)) if app_match else "Docs"
    category = normalize_app_category(raw_app)

    # Resolve primary video
    vid_match = re.search(r"\(videos/([^)]+\.mp4)\)", text)
    video_file = None
    if vid_match and (VIDEOS_DIR / vid_match.group(1)).exists():
        video_file = vid_match.group(1)
    elif (VIDEOS_DIR / f"{slug}.mp4").exists():
        video_file = f"{slug}.mp4"
    elif (VIDEOS_DIR / f"{slug}-ai.mp4").exists():
        video_file = f"{slug}-ai.mp4"
    if not video_file:
        return None

    # Resolve optional AI video
    ai_video_file = None
    if not video_file.endswith("-ai.mp4"):
        ai_candidate = f"{slug}-ai.mp4"
        if (VIDEOS_DIR / ai_candidate).exists():
            ai_video_file = ai_candidate

    # Extract sections
    def get_section(name: str) -> str:
        pat = rf"^##\s+{re.escape(name)}\s*\n(.*?)(?=^##\s+|\Z)"
        m = re.search(pat, text, re.MULTILINE | re.DOTALL)
        return m.group(1).strip() if m else ""

    who_raw = get_section("Who and why")
    who = strip_md(" ".join(line.strip() for line in who_raw.splitlines() if line.strip()))

    scenes_raw = get_section("Scenes")
    scenes = []
    for m in re.finditer(r"^\s*\d+\.\s+\*\*([^*]+?)\.?\*\*\s*(.+)$", scenes_raw, re.MULTILINE):
        scenes.append({
            "heading": strip_md(m.group(1)).rstrip("."),
            "text": strip_md(m.group(2)),
        })
    if not scenes:
        for m in re.finditer(r"^\s*\d+\.\s+(.+)$", scenes_raw, re.MULTILINE):
            line = strip_md(m.group(1))
            scenes.append({"heading": "", "text": line})

    duration = probe_duration(VIDEOS_DIR / video_file)
    ai_duration = probe_duration(VIDEOS_DIR / ai_video_file) if ai_video_file else None

    # Build concise narration tailored to video duration (~2.4 words/sec target)
    target_words = max(22, min(85, int(duration * 2.4)))
    parts = [f"{title}."]
    if who:
        # Take first sentence of who_and_why
        first_sent = re.split(r"(?<=[.!?])\s+", who)[0]
        parts.append(first_sent)

    if scenes:
        # Summarize key scene headings/steps to fit within target word budget
        current_words = len(" ".join(parts).split())
        if current_words < target_words - 8:
            headings = [s["heading"] for s in scenes if s["heading"]]
            if headings and len(headings) >= 2:
                picked = headings[:5]
                step_summary = "Watch as SuiteLeaf walks through " + ", ".join(picked[:-1]) + f", and {picked[-1]}."
                if current_words + len(step_summary.split()) <= target_words + 15:
                    parts.append(step_summary)
            elif scenes[0]["text"]:
                first_step = re.split(r"(?<=[.!?])\s+", scenes[0]["text"])[0]
                parts.append(first_step)

    narration = " ".join(parts)
    # Keep narration crisp
    words = narration.split()
    if len(words) > target_words + 20:
        # Trim to sentence boundary near target
        trimmed = " ".join(words[: target_words + 10])
        last_dot = max(trimmed.rfind("."), trimmed.rfind("!"), trimmed.rfind("?"))
        if last_dot > 40:
            narration = trimmed[: last_dot + 1]

    # Pick speaking rate so audio fits comfortably inside video duration
    est_seconds = len(narration.split()) / 2.65
    if duration > 0 and est_seconds > duration * 0.92:
        ratio = min(1.30, max(1.05, est_seconds / (duration * 0.90)))
        rate_pct = int((ratio - 1.0) * 100)
        rate = f"+{rate_pct}%"
    else:
        rate = "+0%"

    return {
        "id": slug,
        "number": num,
        "title": title,
        "mode": mode,
        "isCluster": "cluster" in mode.lower(),
        "app": raw_app,
        "category": category,
        "summary": who,
        "scenes": scenes,
        "video": f"videos/{video_file}",
        "videoFile": video_file,
        "duration": duration,
        "aiVideo": f"videos/{ai_video_file}" if ai_video_file else None,
        "aiVideoFile": ai_video_file,
        "aiDuration": ai_duration,
        "narration": narration,
        "captions": f"narration/{slug}.vtt",
        "rate": rate,
    }


async def synthesize_one(
    sem: asyncio.Semaphore,
    slug: str,
    text: str,
    rate: str,
    force: bool = False,
) -> bool:
    mp3_path = NARRATION_DIR / f"{slug}.mp3"
    vtt_path = NARRATION_DIR / f"{slug}.vtt"
    if not force and mp3_path.exists() and vtt_path.exists() and mp3_path.stat().st_size > 1000:
        return True

    async with sem:
        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(text, VOICE, rate=rate)
                submaker = edge_tts.SubMaker()
                with open(mp3_path, "wb") as audio_file:
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            audio_file.write(chunk["data"])
                        elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                            submaker.feed(chunk)
                vtt_path.write_text(submaker.get_srt() if not hasattr(submaker, "get_vtt") else submaker.get_vtt(), encoding="utf-8")
                # Ensure valid WEBVTT header if library returned SRT
                raw_sub = vtt_path.read_text(encoding="utf-8")
                if not raw_sub.lstrip().startswith("WEBVTT"):
                    # Convert SRT timestamps (00:00:01,000 -> 00:00:01.000) to WebVTT
                    vtt_body = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", raw_sub)
                    vtt_path.write_text("WEBVTT\n\n" + vtt_body, encoding="utf-8")
                return True
            except Exception as exc:
                if attempt == 2:
                    print(f"[ERROR] Failed {slug}: {exc}", file=sys.stderr)
                    return False
                await asyncio.sleep(1.5 * (attempt + 1))
    return False


async def main() -> None:
    force = "--force" in sys.argv
    NARRATION_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    md_files = sorted(
        (p for p in STORYBOARDS_DIR.iterdir() if re.match(r"^\d+-.*\.md$", p.name)),
        key=lambda p: (int(p.name.split("-", 1)[0]), p.name),
    )

    items = []
    for p in md_files:
        parsed = parse_storyboard(p)
        if parsed:
            items.append(parsed)

    print(f"Parsed {len(items)} storyboards. Synthesizing narrations with {VOICE}...")

    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = [
        synthesize_one(sem, "account-setup", ACCOUNT_SETUP_SCRIPT, "+4%", force=force)
    ]
    for item in items:
        tasks.append(
            synthesize_one(sem, item["id"], item["narration"], item["rate"], force=force)
        )

    results = await asyncio.gather(*tasks)
    ok_count = sum(1 for r in results if r)
    print(f"Synthesized {ok_count}/{len(tasks)} narration tracks.")

    # Write clean catalog JSON (without internal rate field)
    catalog = {
        "generatedWith": VOICE,
        "totalCount": len(items),
        "aiCount": sum(1 for i in items if i["aiVideo"]),
        "accountSetup": {
            "title": "Connect to a Server & Create Your Account",
            "video": "videos/account-setup.mp4",
            "captions": "narration/account-setup.vtt",
            "narration": ACCOUNT_SETUP_SCRIPT,
            "duration": probe_duration(VIDEOS_DIR / "22-connect-to-your-team-server.mp4"),
        },
        "storyboards": [
            {k: v for k, v in item.items() if k != "rate"} for item in items
        ],
    }
    (DATA_DIR / "storyboards.json").write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {DATA_DIR / 'storyboards.json'}")
    if ok_count < len(tasks):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

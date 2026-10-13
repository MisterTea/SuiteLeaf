# 21 · Present with speaker notes

**Mode:** single-node · **App:** Slides · **Video:** [videos/21-present-with-speaker-notes.mp4](videos/21-present-with-speaker-notes.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

It's Saturday morning. Priya opens the garden kickoff slides she saved last night, jots a reminder under each slide, and presents them from her laptop. She's nervous about forgetting things, so the notes matter.

## Inspired by

- W12 Slides: speaker notes and a fullscreen slide show ([docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md)).
- [PowerPoint: Start the presentation and see your notes in Presenter view](https://support.microsoft.com/en-us/office/start-the-presentation-and-see-your-notes-in-presenter-view-4de90e28-487e-435c-9401-eb49a3801257): notes on the presenter's screen, only slides for the audience.
- [r/EventProduction: Using Google Slides for a live event](https://www.reddit.com/r/EventProduction/comments/1qdk2vf/using_google_slides_for_a_live_event/) and [r/powerpoint: Presenter Mode doesn't show speaker notes](https://www.reddit.com/r/powerpoint/comments/wkc0xh/help_presenter_mode_doesnt_show_speaker_notes/): presenters rely on notes and get stuck when they don't appear.

## Scenes

1. **Open the deck.** On the home screen Priya clicks "Open / import" and picks "Spring Garden Kickoff.slslides". It opens with four slides.
2. **Speaker notes.** Under the slide she clicks "Click to add speaker notes" and types "Welcome everyone. Thank the library for the room."
3. **A note per slide.** She selects slides 2 and 3 in the thumbnails and adds a reminder to each.
4. **Start from the beginning.** Still on slide 3, she opens the arrow next to Slideshow. The menu offers "Present from beginning" (Cmd+Shift+Enter), "Present from current slide" (Cmd+Enter), and "Present with speaker notes". She picks Present from beginning. The show opens in full screen on slide 1, and the controls fade after a moment.
5. **Rehearse with notes.** She presses S. Her note for the slide appears beside it, with a timer and a preview of the next slide ("Next: This season's plan").
6. **Advance.** The right arrow key moves to "This season's plan", then "How you can help". The notes change with the slide.
7. **Present.** When people arrive, she presses S again so the slide fills the screen. Moving the mouse brings back Previous, "Slide 3 of 4", Next, Notes, and Exit. She clicks Next to reach "Questions?".
8. **End.** Escape ends the show and leaves full screen. Back in the editor, the first slide's note is still there.

## Success looks like

- Each slide has its own speaker notes, saved with the presentation.
- The show can start from the beginning or from the current slide, from the menu or the keyboard.
- The show asks the browser (or the desktop app's window) for real full screen, and leaving full screen ends the show.
- Speaker notes, elapsed time, and the next slide are one key (S) or click (Notes) away during the show.
- Slide text keeps the same proportions as in the editor at any screen size.
- Keyboard: arrows, Space, Page Up/Down, Home/End to move; B or W for a black or white screen; S for notes; Escape to exit. Clicking the slide also advances.

## AI version

**Videos:** [web](videos/21-present-with-speaker-notes-ai.mp4) · [desktop](videos/electron/21-present-with-speaker-notes-ai.mp4) · **Script:** [scenes/ai/21-present-with-speaker-notes-ai.spec.ts](scenes/ai/21-present-with-speaker-notes-ai.spec.ts)

From the home screen Priya asks the on-device assistant (Gemma 4 E4B) twice:

1. "Open the Spring Garden Kickoff slides I saved last night and add speaker notes to the first three slides. Slide 1: Welcome everyone. Thank the library for the room. Slide 2: Mention the compost delivery on Friday. Slide 3: Pass the sign-up sheet around now."
2. "Let's rehearse. Start the slideshow from the beginning with my notes showing, go through the slides until Questions?, then end the show."

Gemma uses `open_file`, `set_speaker_notes` (three times), `start_presentation` with notes, `next_slide` (three times) and `end_presentation`. In the recording the pointer goes to Open / import and the panel asks Priya to choose the file; she picks "Spring Garden Kickoff.slslides" and the four-slide deck opens. The pointer then goes to the notes box under each slide, and each note is typed in as the slide is shown. For the second request the pointer goes to Slideshow. The show opens in full screen on slide 1 with "Welcome everyone…" beside it, a timer and "Next: This season's plan". The pointer then clicks Next three times, with the show's controls visible each time. The notes change with each slide, and "Questions?" shows "No speaker notes for this slide". Finally it clicks Exit. Back in the editor Priya clicks through the thumbnails to check the notes. The test watches the show as it runs. It checks that the show started on slide 1 in full screen with slide 1's note, that each of slides 1–3 appeared with its own note, that it reached slide 4, and that it ended and left full screen. Afterwards slides 1–3 each have their own note and slide 4 has none. As in the original, the recording replaces the Fullscreen API with a stand-in.

Fixes made along the way:

- Gemma's third identical `next_slide` call was blocked as a loop ("You already made this exact call twice"), so the show stopped on slide 3. Tools can now be marked repeatable, and `next_slide` is.
- `next_slide` and `start_presentation` now name the slide on screen ("slide 3 of 4, "How you can help""). `next_slide` fails on the last slide and points to `end_presentation`, and `start_presentation` says whether the show is in full screen.
- Before pointing at Next or Exit, the agent brings back the show's controls the way moving the mouse does. The controls hide after 2.5 seconds, so the pointer used to click empty black space.
- When the deck wasn't in the file list, Gemma gave up or asked Priya to confirm (three runs in a row). The tools pointed it elsewhere: `open_file` said only "Files: none", and `search_files` said "No files match". Now `open_file` asks the user to pick a file that isn't in the library, as Open / import does. `search_files` with no match, and the system prompt, say such a file is on the user's computer and to open it without asking.
- One reply wrote `call:open_from_computer{}` without its opening token and was shown as text. The parser now reads it; this fix is the same commit as storyboard 22's.

**How Gemma did:** with the final tools, web passed 3 of 5 runs and desktop 1 of 1. Both web failures came from the same model habit: after adding the notes, Gemma called `back_to_files` and closed the deck, though the system prompt and the tool description say to leave it open. Across all ten web runs, the notes were always right: the exact text on the right slide. Whenever the second request ran, the show was right too: `start_presentation` from slide 1 with notes, three `next_slide` calls, then `end_presentation`. Mistakes seen before the fixes: it searched the empty library and stopped to ask "Can you confirm the exact name of the file?". After a clear error saying to call `open_from_computer`, it told Priya to "select it from your computer's files when prompted" and stopped without calling it. It also passed an unrelated CSV option (`first_row_is_header: false`) to `open_from_computer`.

## Gaps and notes

- Notes appear in the same window as the slide, like PowerPoint's presenter view on a single screen. If the laptop is mirrored to a projector, the audience sees them too. A separate presenter window for a second screen (Google Slides' "Presenter view", PowerPoint's dual-monitor mode) is a follow-up.
- The recording replaces the browser's Fullscreen API with a stand-in, because real full screen resizes the headless recording window. The script checks that SuiteLeaf asks for full screen and leaves it on Escape; the browser tests check the real API.
- In the editor on narrow (phone-sized) screens, slide text is drawn at a fixed pixel size, so it looks larger relative to the slide than it does in the show. The show itself scales correctly.
- The HTML export still draws text at 1.5× the deck size, so exported slides don't match the editor or the show.
- No end-of-show screen, slide-number jump, or laser pointer during the show.
- When the assistant starts the show, the call comes seconds after Priya's last key press. Browsers allow full screen only right after a click or key press, so in a normal browser window the show may stay in the window. `start_presentation` tells the assistant when that happens. The recordings use the full-screen stand-in, so they don't show this.

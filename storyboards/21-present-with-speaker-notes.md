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

## Gaps and notes

- Notes appear in the same window as the slide, like PowerPoint's presenter view on a single screen. If the laptop is mirrored to a projector, the audience sees them too. A separate presenter window for a second screen (Google Slides' "Presenter view", PowerPoint's dual-monitor mode) is a follow-up.
- The recording replaces the browser's Fullscreen API with a stand-in, because real full screen resizes the headless recording window. The script checks that SuiteLeaf asks for full screen and leaves it on Escape; the browser tests check the real API.
- In the editor on narrow (phone-sized) screens, slide text is drawn at a fixed pixel size, so it looks larger relative to the slide than it does in the show. The show itself scales correctly.
- The HTML export still draws text at 1.5× the deck size, so exported slides don't match the editor or the show.
- No end-of-show screen, slide-number jump, or laser pointer during the show.

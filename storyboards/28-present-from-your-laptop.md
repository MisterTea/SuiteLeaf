# 28 · Present from your laptop

**Mode:** single-node · **App:** Slides · **Video:** [videos/28-present-from-your-laptop.mp4](videos/28-present-from-your-laptop.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

Priya is about to give the garden club kickoff from her laptop, in a library room, with no second monitor. She wrote a reminder under each slide last night. In Google Slides the Slideshow button hides those notes, and Presenter view is a second window that often opens on the wrong screen. She needs the notes, the next slide, and a clock on this screen, and a way to fill the screen with only the slide when she turns the laptop toward the room.

## Inspired by

- Storyboard [21](21-present-with-speaker-notes.md): notes save with the deck, and the slide show never shows them.
- [Present slides with presenter view](https://support.google.com/docs/answer/1696787): Google opens a separate window for notes, a timer, and the next slide, and the audience window is easy to put on the wrong display.
- [r/powerpoint: Presenter Mode doesn't show speaker notes](https://www.reddit.com/r/powerpoint/comments/wkc0xh/help_presenter_mode_doesnt_show_speaker_notes/): people walk up to present and the notes are missing.

## Scenes

1. **Open the deck.** Priya opens a short presentation that already has speaker notes on the first slides.
2. **Present on this screen.** She clicks **Slideshow**. Because the deck has notes, the show opens as presenter view in the same window: the current slide, the next slide, her notes in type large enough to read at arm's length, and a timer that is already running. She does not pick a second mode and no extra window appears.
3. **Read the note.** The first note, "Welcome everyone. Thank the library for the room.", is on screen next to the slide, not hidden until she remembers a menu.
4. **Advance.** The right arrow moves to the next slide. The note changes to that slide's note, the next-slide thumbnail updates, and the timer keeps counting.
5. **Turn the laptop toward the room.** She presses **N**. The notes, the next slide, and the timer hide, and the current slide fills the window. She presses **N** again and the presenter view returns, on the same slide, with the timer still running.
6. **Black the screen.** She presses **B**. The audience sees a black slide. Her notes stay visible. She presses **B** again and the slide comes back.
7. **Leave the show.** Escape returns to the editor. The notes are still under the slides.

## Success looks like

- A deck with notes opens into presenter view from the Slideshow button, in this window.
- Notes are large, the next slide is visible, and the timer starts on its own.
- **N** swaps between presenter view and a slide-only fill of the same window, without losing the place or the timer.
- **B** blacks only the slide. The notes stay.
- Escape leaves the show with the notes still saved.

## Better than Google Slides

- Presenter view is the show, not a second window and not a mode hidden beside Slideshow.
- One laptop is enough. **N** is how the room sees only the slide, so nothing depends on which display a popup landed on.
- The timer and the next slide are on screen from the first moment.
- Blanking the slide does not blank the notes.

## Gaps and notes

- Recorded. Slideshow on a deck with notes opens presenter view in this window: the current slide, a smaller next slide, the notes in large type, and a timer. In the recording the timer ran from 0:01 through 0:15. It kept going when the right arrow changed the note and the next slide, and it did not restart when N hid presenter view and brought it back on the same slide. B turned the slide black and left the notes, the next slide, and the timer visible. Escape returned to the editor with the first note still under the slide. The Slideshow button no longer shows a chevron.
- The show fills the browser window and does not enter fullscreen, so on the web the tabs and address bar stay visible.
- There is no laser pointer, no jump to a slide number, and no white blank (W).

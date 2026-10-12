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
4. **Start the show.** She selects the first slide and clicks Slideshow. The slide fills the window on a black background.
5. **Advance.** The right arrow key moves to "This season's plan", then "How you can help".
6. **On-screen controls.** Moving the mouse shows Previous, "Slide 3 of 4", Next, and Exit. She clicks Next to reach "Questions?".
7. **End.** Escape closes the show. Back in the editor, the first slide's note is still there.

## Success looks like

- Each slide has its own speaker notes, saved with the presentation.
- The slide show starts from the chosen slide and advances with the keyboard and the on-screen controls.

## Gaps and notes

- There is no presenter view. Speaker notes don't appear anywhere during the slide show, so Priya can't read them while presenting. PowerPoint and Google Slides show notes, a timer, and the next slide on the presenter's screen.
- The slide show fills the browser window but doesn't enter real fullscreen, so on the web the browser's tabs and address bar stay visible unless the user presses F11 or uses the browser's own fullscreen.
- Slideshow always starts from the selected slide. There is no "From beginning" option. The chevron on the Slideshow button looks like a menu but is part of the same button.
- No blank-screen key (B/W), slide-number jump, or laser pointer during the show.

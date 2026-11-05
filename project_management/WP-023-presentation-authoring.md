---
id: "WP-023"
title: "Professional presentation authoring and accessible design"
type: "work_package"
status: "done"
priority: "P1"
phase: 3
area: "presentations"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S19"]
---

# Professional presentation authoring and accessible design

## Outcome and rationale

Extend existing slide tools into complete professional authoring workflows with coherent masters, reusable design, and accessible output.

## Existing implementation and starting points

SuiteLeaf already has themes, masters, transitions, animation panes, presenter notes, media, and PPTX export. Inspect `apps/web/src/editors/Slides.tsx`, `slide-master-panel.tsx`, `slide-animation-pane.tsx`, `slide-theme-library.ts`, and `slide-media.tsx`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Audit and complete master/layout editing, placeholder inheritance, theme fonts/colors, brand templates, and design propagation without destroying slide-specific overrides.
- Complete selection/layer management, grouping, alignment/distribution, snapping/guides, object locking, and precise geometry controls where current behavior is insufficient.
- Expand prioritized animation timing, order, triggers, and transition behavior with a preview identical to slideshow playback; clearly map supported export behavior.
- Add alt-text and reading-order tools, contrast/missing-title checks, accessible chart summaries, and caption/subtitle support for media and presentations.
- Support presenter next-slide/notes/timer workflows and document behavior for separate audience/presenter displays.
- Coordinate shared template distribution with WP-036 and exported accessibility with WP-029.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Changing a master updates inheriting slides while preserving documented overrides.
- Users can create a polished branded deck without editing source data manually.
- Reading order and alt text are inspectable and survive native files and supported exports.
- Preview and slideshow execute the supported animation sequence consistently.

## Verification

- Vitest for inheritance, geometry commands, animation sequencing, and accessibility metadata.
- Painted-canvas tests for alignment, selection, guides, animation appearance, and presenter layouts.
- Manual assistive-technology review of representative decks with recorded findings.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Do not claim full SmartArt, Morph, or arbitrary PowerPoint animation compatibility. Identify unsupported semantics and prioritize according to corpus/customer workflows.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S19`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `packages/core/src/slide-access.ts` copies a master's alternative text onto a slide object with the same id. An object with `altOverride` keeps its own text. `readingOrder` follows the stored id list, reports an id that is not on the slide, and appends objects the list left out. An image with no alternative text is named by its id. The pieces and the order round-trip as JSON. `tests/slide-access.test.ts` passed (2 tests). Limits are in `docs/slide-access.md`.

2026-10-30, later: the slide toolbar button Accessibility lists the current slide's reading order and access notes. Audio and video are skipped. `npx vitest run tests/ui/slide-access-notes.test.tsx` passed (1 test). In the browser, an existing presentation showed the reading order of its two text objects and “No notes for this slide.” A second click hid the section.

2026-10-31: an image description survives a PowerPoint export and import. `npx vitest run tests/pptx-alt.test.ts` passed (1 test). A SuiteLeaf marker for an SVG or an image layer is not used as that description. The reading-order list is still not a separate field in the PowerPoint file.

2026-10-31, later: a slide can store `readingOrder`. The accessibility list uses that order when it is present. A PowerPoint export writes the list into the slide XML, and import reads it back onto the slide. `npx vitest run tests/pptx-reading-order.test.ts tests/ui/slide-access-notes.test.tsx tests/pptx-alt.test.ts tests/slide-access.test.ts` passed (6 tests). An id that cannot be named on a shape is left out. Audio and video are not placed in that list. This was not opened in the browser, because the existing presentation has no stored reading order.

2026-10-31, later still: `animationSequence` is the click order for the slideshow and for the PowerPoint timing. `photo` has order 0 and plays before `title`, which has no stored order and therefore follows its place on the slide. `note` has no animation and is left out. `fadeOnClickIds` returns the same ids. The input list still starts with `title`. `npx vitest run tests/slide-animation-order.test.ts tests/slide-fade-in.test.ts` passed (5 tests). The slideshow was not opened in the browser.

2026-11-01: two objects with animation order 1 are one click. The slideshow reveals the title and the photo together. The entrance plays on the title, and the photo is shown with it. A note with no animation stays out. The PowerPoint file has one `clickEffect` and one `withEffect`, and reading it back keeps both at order 1. The file does not contain `secret-value`. `npx vitest run tests/slide-animation-order.test.ts tests/slide-fade-in.test.ts` passed (7 tests). The slideshow was not opened in the browser.

2026-11-01: an object marked `after` starts when the previous entrance finishes and does not take its own click. The title is the entrance. The photo waits, then uses its fly-in. A note with no animation stays out. The PowerPoint file has one `clickEffect` and one `afterEffect`. Reading it back keeps the photo as `after`. The file does not contain `secret-value`. `npx vitest run tests/slide-animation-order.test.ts tests/slide-fade-in.test.ts` passed (9 tests). Reduced motion shows that object immediately. The slideshow was not opened in the browser.

2026-11-01: the animation pane uses the same click numbers as the slideshow. Welcome is click 1. A photo marked `after` is also click 1 and says after previous. A note whose text is `secret-value` has no animation and is left out of the list. `npx vitest run tests/slide-animation-pane.test.ts tests/ui/slide-animation-pane.test.tsx tests/slide-fade-in.test.ts tests/slide-animation-order.test.ts` passed (13 tests). The animation pane was not opened in the browser. The slideshow was not opened. The slide canvas was not opened.

2026-11-01: an entrance can store a length. `1500` stays `1500` when the deck is saved and opened. A missing length is 600 milliseconds. A length of `9000` plays as 5000, and a length that is not a number plays as 600. The slideshow sets that length on the entrance style. The animation pane does not play it. `npx vitest run tests/slide-fade-in.test.ts` passed (7 tests). The slideshow was not opened in the browser. The slide canvas was not opened.

2026-11-01: the animation pane lists the same entrance length the slideshow uses. Welcome at `1500` says `1500 ms`. A stored `9000` says `5000 ms`. A missing length says `600 ms`. A note whose text is `secret-value` stays out of the list. The pane still does not play the motion. `npx vitest run tests/ui/slide-animation-pane.test.tsx tests/slide-animation-pane.test.ts tests/slide-fade-in.test.ts` passed (11 tests). The animation pane was not opened in the browser. The slideshow was not opened. The slide canvas was not opened.

2026-11-01: Preview in the animation pane uses the same entrance class and length as the slideshow. Welcome is `show-object fade-on-click-enter` for `1500ms`. The photo marked after is `show-object fly-on-click-enter animation-after-previous` for `5000ms`, and the stored `9000` is not used. A note whose text is `secret-value` stays out of the preview. `npx vitest run tests/ui/slide-animation-pane.test.tsx tests/slide-animation-pane.test.ts tests/slide-fade-in.test.ts` passed (11 tests). The animation pane was not opened in the browser. The slideshow was not opened. The slide canvas was not opened.

2026-11-01: Audience screen writes a separate window. The title Welcome is the only heading. A blank screen says `The screen is blank.` and does not include `secret-value`. A slide with no title is `Slide 2`. A missing window does not write. `npx vitest run tests/audience-screen.test.ts` passed (1 test). The slideshow was not opened. The audience window was not opened in the browser.

2026-11-01: the audience window includes the slide’s visible text. Welcome is the heading. `North beds` and the image description `Tomato` follow it. Speaker notes `secret-value` are not in the window. A blank screen says `The screen is blank.` and does not include Welcome or Tomato. `npx vitest run tests/audience-screen.test.ts` passed (1 test). The slideshow was not opened. The audience window was not opened in the browser.

2026-11-01: while the show is open, moving to the next slide replaces the audience window. Welcome is removed and `North beds` becomes the heading. Blanking the screen then says `The screen is blank.` and does not include `secret-value`. `npx vitest run tests/audience-screen.test.ts` passed (2 tests). The slideshow was not opened. The audience window was not opened in the browser.

2026-11-01: an object that waits for a click stays off the audience window until it is revealed. Welcome is shown. `secret-value` is not in the window until that click. After the click, that line is shown. `npx vitest run tests/audience-screen.test.ts` passed (3 tests). The slideshow was not opened. The audience window was not opened in the browser.

2026-11-01: a video without caption text says `This video has no captions.` The address `secret-value` is not in that note. Pictures inside audio and video are still not checked. `npx vitest run tests/ui/slide-access-notes.test.tsx tests/slide-access.test.ts` passed (9 tests). The accessibility panel was not opened in the browser. This is not a WCAG conformance claim.

2026-11-01: a video is in the reading order with the title and the photo. Without alternative text it says `This video needs alternative text.` The address `secret-value` is not in that note. `npx vitest run tests/ui/slide-access-notes.test.tsx tests/slide-access.test.ts` passed (9 tests). The accessibility panel was not opened in the browser. This is not a WCAG conformance claim.

2026-11-01: Size and position accepts x `80`, y `20`, width `100`, and height `40`. A value of `secret-value` says to enter a number for x, and that word is not in the message. A width of 0 is refused. A locked box stays at x 10. The panel applies x 80 for an unlocked title and says the position was applied. A locked title is not moved. The Align menu includes Size and position. `npx vitest run tests/slide-geometry.test.ts tests/ui/slide-geometry-panel.test.tsx tests/slide-align.test.ts` passed (4 tests). At `http://127.0.0.1:5173/` an Untitled presentation was opened. Align, then Size and position, showed the panel. After the title was selected, the fields were x 100, y 160, width 760, and height 100. Setting x to 80 and choosing Apply position said the position was applied, and x stayed 80. Undo was then available. Opening the panel again showed x 100. The slide canvas was not measured.

2026-11-01: a video caption `North beds` is kept when the deck is saved and opened again. The caption track contains those words. The media address `secret-value` stays on the clip and is not in the track. `npx vitest run tests/ui/slide-media-caption.test.tsx` passed (1 test). The slideshow was not opened in the browser. This is not a WCAG conformance claim.

2026-10-31, later: a title box with no font size uses the master title size 32. After the master size becomes 28, a box that stores 14 stays 14. The slide box passed in still has no font size, and the master passed in stays 32. The editor draws a text box at that inherited size. `npx vitest run tests/slide-master.test.ts` passed (3 tests). The slide canvas was not opened in the browser.

2026-10-31, later: a title box with no color or font uses the master title color `#112233` and family Georgia. After the master color becomes `#445566` and the family becomes Verdana, that box uses the new values. A box that stores `#000000` and Arial keeps those. The slide box passed in still has no color, and the master passed in stays `#112233`. The editor draws a text box with that inherited color and family. A rendered title with no stored color or family is drawn as `rgb(17, 34, 51)` and Georgia. `npx vitest run tests/slide-master.test.ts tests/ui/slide-master-paint.test.tsx` passed (5 tests). The slide canvas was not opened in the browser.

2026-10-31, later: applying the Meadow theme sets the master background to that theme and changes the footer `Garden club` to the theme body font and colour. The master object that stores Courier and `#000000` keeps both. Applying Ink then changes the footer font and still leaves Courier. The master passed in still uses Arial. A deck with no master stays without one. `npx vitest run tests/slide-theme.test.ts tests/slide-runs.test.ts tests/slide-marp-sync.test.ts` passed (62 tests). The slide canvas was not opened in the browser.

2026-10-31, later: aligning the title at x 10 and the photo at x 40 to the left puts both at x 10. The note at x 200 stays there. The photo passed in stays at x 40. A locked photo stays at x 40. One selected box is not moved. Spacing boxes at x 0, 30, and 100, each 20 wide, puts the middle box at x 50 and leaves the ends. On a 960 by 540 slide, centering a 100-wide title moves it to x 430. A locked title stays at x 10. The Align menu on the slide toolbar moves the one selected box to the slide edge. It does not select several boxes, so shared-edge alignment and distribution are not on that menu. `npx vitest run tests/slide-align.test.ts` passed (1 test). The Align menu was not opened in the browser. The slide canvas was not opened.

2026-10-31, later: a locked title at x 10 stays at x 10 when a change asks for x 80. Its text still becomes `North`. Unlocking in that same change moves it to x 80. The lock is stored on the object and read back. A locked box is not dragged or resized. The Align menu shows Lock, or Unlock when the selected box is locked. `npx vitest run tests/slide-align.test.ts` passed (1 test). The menu was not opened in the browser. The slide canvas was not opened.

2026-10-31, later: later boxes are painted on top. Bring forward moves photo from between title and note to the end, so the order is title, note, photo. Send to back paints photo first. Bring to front paints title last. The list passed in stays title, photo, note. A box that is already at that end is left there, and no new undo step is recorded. The Align menu has Bring forward, Send backward, Bring to front, and Send to back. `npx vitest run tests/slide-align.test.ts` passed (1 test). The menu was not opened in the browser. The slide canvas was not opened.

2026-10-31, later: a moving box within 8 units of another box's edge snaps to that edge. A photo at x 14 next to a title at x 10 moves to x 10, and the vertical guide is at x 10. A photo at x 40 stays at x 40. On a 960-wide slide, a 100-wide box at x 426 snaps to x 430, and the guide is at 480. The title passed in stays at x 10. While a drag is snapped, the canvas draws a green guide line. The line is removed when the drag ends. `npx vitest run tests/slide-align.test.ts` passed (1 test). The canvas was not dragged in the browser.

2026-10-31, later: shift-click adds a box to the selection. Group gives the title and the photo the same group id. The note stays out of the group. One selected box is not grouped. Dragging the title by 12 also moves the photo by 12, from x 40 to x 52. A locked photo stays at x 40. Ungrouping the photo also clears the title. The group id is stored on the box and read back. The Align menu has Group and Ungroup. `npx vitest run tests/slide-align.test.ts` passed (1 test). The menu was not opened in the browser, and two boxes were not shift-clicked there.

2026-10-31, later: `showFrame` gives the audience slide 0 and keeps the note `Say secret-value slowly` on the presenter frame. The audience frame does not contain `secret-value`. The next title is Paths. On the last slide the next title is cleared, the frame is ended, and a negative elapsed time is stored as 0. A blank screen stays blank for the audience while the presenter still has the last note. `npx vitest run tests/presenter-display.test.ts` passed (1 test). The slideshow uses this split in one window. A second display was not opened. The slideshow was not opened in the browser.

2026-11-01: `shownElapsedMs` holds 10 seconds while paused and keeps 65 seconds while running. A paused time that is not a number is 0. The presenter notes header has Pause timer and Resume timer. Starting the show clears a pause. `npx vitest run tests/presenter-display.test.ts` passed (2 tests). The slideshow was not opened in the browser. A second display was not opened.

2026-10-31, later: one selected box, the title, aligns to the left edge of a 960-wide slide, so its x becomes 0. The photo at x 40 stays there. Two selected boxes, the title at x 10 and the photo at x 40, align to the shared left edge, so both are at x 10. The note at x 200 stays there. The boxes passed in stay at x 10 and x 40. Distribute horizontally still puts boxes at x 0, 30, and 100 onto x 0, 50, and 100. The Align menu calls that selection. It has Distribute horizontally and Distribute vertically. `npx vitest run tests/slide-align.test.ts` passed (2 tests). The menu was not opened in the browser, and two boxes were not shift-clicked there. The slide canvas was not opened.

2026-10-31, later: a slide with a blank title needs a title. A title color of `#ffff00` on a white slide does not contrast. Black on white has no note. A text color of `secret-value` is not a hex color, and that word is not in the note. The accessibility panel shows the title note and the contrast note. `npx vitest run tests/slide-access.test.ts tests/ui/slide-access-notes.test.tsx` passed (6 tests). The panel was not opened in the browser. This is not a WCAG conformance claim.

2026-10-31, later: the title check uses the title box color. A box named Beds with a word color of `#ffff00` fails against a white slide. The next box, colored black, is not the one that is checked. A title color of `secret-value` is not a hex color, and that word is not in the note. A slide with no text box still uses `#111111`. `npx vitest run tests/slide-access.test.ts tests/ui/slide-access-notes.test.tsx` passed (7 tests). The panel was not opened in the browser. This is not a WCAG conformance claim.

2026-11-01: with an object selected, the arrow keys move that object. Right moves it by 1. Shift plus Up moves it by 10. A locked box stays where it is. With nothing selected, Left and Right still change slides. Typing in a text box does not move the object. `npx vitest run tests/slide-align.test.ts tests/slide-editing.test.ts` passed (13 tests). The slide canvas was not used. The slideshow was not opened.

2026-11-01: a slide can advance on its own after a whole number of seconds. Five seconds is a 5,000 millisecond wait. A blank screen, a paused timer, and a value `secret-value` do not advance, and that word is not a wait. The Transition panel stores Advance after seconds on the selected slides. `npx vitest run tests/presenter-display.test.ts` passed (3 tests). The slideshow was not opened in the browser. A second display was not opened.

2026-11-01: an arrow key moves every unlocked box in the selected group. The title at x 10 moves to x 20, and a locked box in that group stays at x 40. A box that is not in the group stays at x 80. Choosing the locked box does not move the others. The list passed in stays as it was. `npx vitest run tests/slide-align.test.ts tests/slide-editing.test.ts` passed (14 tests). The slide canvas was not used.

2026-11-01: the slideshow skips a hidden slide. Next from the first slide lands on the third when the second is hidden. Previous returns to the first. Home skips a hidden first slide and lands on the second. `npx vitest run tests/slide-fade-in.test.ts` passed (8 tests). The slideshow was not opened in the browser. A second display was not opened.

2026-11-01: the presenter's next label uses the next visible slide. When that slide has no heading, index 2 says `Slide 3`. A heading `Beds` stays `Beds`. No next slide has no label, and a heading `secret-value` is not used in that case. `npx vitest run tests/presenter-display.test.ts` passed (4 tests). The slideshow was not opened in the browser. A second display was not opened.

2026-11-01: a slide fade whose duration is not a number lasts 0 ms. A fade of 0.4 seconds is still 400 ms. Reduced motion is still 0. `npx vitest run tests/slide-theme.test.ts -t "drops the duration"` passed (1 test). The slideshow was not opened in the browser.

2026-11-01: a group id that is only space does not move the other boxes. Selecting the first box and nudging right moves that box from 10 to 20 and leaves the other box at 40. A named group still moves together. `npx vitest run tests/slide-align.test.ts -t "unlocked box in the selected group"` passed (1 test). The slide canvas was not used.

2026-11-01: the audience screen includes words on a shape. A shape that says `Beds` is listed with the text box and the image description. Speaker notes stay off that screen. `npx vitest run tests/audience-screen.test.ts` passed (3 tests). The slideshow was not opened in the browser. A second display was not opened.

2026-11-01: the audience screen includes words in a table. `Plot`, `North`, and `10` are listed. A blank cell is left off. Speaker notes stay off that screen. `npx vitest run tests/audience-screen.test.ts` passed (3 tests). The slideshow was not opened in the browser. A second display was not opened.

2026-11-01: the presenter clock shows hours after one hour. 65 seconds is `1:05`. 3,661 seconds is `1:01:01`. A time that is not a number is `0:00`. `npx vitest run tests/presenter-display.test.ts` passed (5 tests). The slideshow was not opened in the browser. A second display was not opened.

2026-11-01: a blank title uses the master title text. The title box shows `Garden club`. After the master text becomes `Paths`, a blank title shows `Paths`. A title that stores `North` stays `North` when the master text is `secret-value`, and that word is not in the title box. The slide title passed in stays blank until it stores `North`. `npx vitest run tests/slide-master.test.ts tests/ui/slide-master-paint.test.tsx -t "master text|blank title"` passed (2 tests). The slide canvas was not opened in the browser. The slideshow was not opened.

2026-11-01: the audience window uses that same master title. A blank title is `Garden club`. A title that stores `North` stays `North` when the master text is `secret-value`, and that word is not in the audience lines. The slideshow passes the master into the audience window. `npx vitest run tests/audience-screen.test.ts -t "master title"` passed. The slideshow was not opened. The audience window was not opened in the browser. A second display was not opened.

2026-11-01: the presenter's next label uses that same master title. A blank next title is `Garden club`. A next title that stores `North` stays `North` when the master text is `secret-value`. A slide with no text box still says `Slide 3`. `npx vitest run tests/presenter-display.test.ts -t "next visible"` passed. The slideshow was not opened. A second display was not opened.

2026-11-01: a plain-text export skips a hidden slide. The file says `Slides: 1` and `--- Slide 1: North ---`, and it keeps the speaker notes `Water the beds`. The hidden title and notes `secret-value` are not in the file. The hidden slide passed in still has those notes. `npx vitest run tests/slide-plain-text.test.ts` passed (1 test). The slideshow was not opened. A second display was not opened.

2026-11-01: the HTML download also skips a hidden slide. The hidden notes `secret-value` are not in the file. A visible slide still shows `North`, and its notes are below the slide as `Notes: Water <the> beds` with the markup escaped. The page title is escaped. The hidden slide passed in still has those notes. `npx vitest run tests/slide-html.test.ts tests/slide-plain-text.test.ts` passed (4 tests). The slideshow was not opened. A second display was not opened.

2026-11-01: Marp markdown keeps a hidden slide. The file contains `<!-- _hidden: true -->`. Reading it back keeps the slide hidden, and the speaker notes stay `Water the beds`. A hidden value `secret-value` says `Slide 1: Hidden must be true or false.` and that word is not in the message. `npx vitest run tests/slide-marp.test.ts -t "hidden slide"` passed (1 test). The slideshow was not opened. A second display was not opened.

2026-11-01: a decorative object is left out of the plain-text and HTML downloads. The visible text `North` and `Beds` stay. The decorative text `secret-value` stays on the slide and is not in either download. `npx vitest run tests/slide-plain-text.test.ts tests/slide-html.test.ts` passed (6 tests). The slideshow was not opened. A second display was not opened.

2026-11-01: an HTML download keeps a quote in a picture address or description inside the attribute. `Water "the" beds` stays as the description. A slide color that is not a color is left out, so `secret-value` is not in the download, and the slide still stores that color. `npx vitest run tests/slide-html.test.ts` passed (5 tests). The slideshow was not opened. The HTML file was not opened in a browser.

2026-11-01: a print of the deck includes speaker notes under a visible slide. The notes `Water <the> beds` stay text, so the markup is not a tag. A hidden slide's notes `secret-value` are left out, and that slide still stores them. `npx vitest run tests/ui/slide-print.test.tsx -t "speaker notes|prints every slide"` passed (2 tests). The slideshow was not opened. A printer was not used.

2026-11-01: speaker notes print after the slide box, so the fixed slide does not clip them, and the next slide starts after those notes. `Water <the> beds` stays text. A hidden slide's notes stay out. `npx vitest run tests/ui/slide-print.test.tsx -t "speaker notes|prints every slide"` passed (2 tests). The slideshow was not opened. A printer was not used.

2026-11-01: an HTML download uses the master background when the slide stores no color. The page is `#112233`. A slide that stores `#000000` stays that color when the master color is `secret-value`, and that word is not in the file. A master color that is not a color is left out, so the page is `#fff`. `npx vitest run tests/slide-html.test.ts` passed (6 tests). The slideshow was not opened. The HTML file was not opened in a browser.

2026-11-01: a slide table is a text field in the accessibility panel. `Plot` and `North`, then `Beds` and `10`, are shown with a tab between cells. Changing `North` to `South` is reported as those rows. A line with one cell says `Keep the same number of columns.` and is not stored. That sentence does not include `secret-value`. The table passed in stays `North`. `npx vitest run tests/ui/slide-access-notes.test.tsx` passed (7 tests) at 00:48:16. The accessibility panel was not opened in the browser. The slide canvas was not used. This is not a WCAG conformance claim.

2026-11-02: an HTML download keeps an https clip address. `https://example.test/beds.mp4` stays in the file. A `javascript:` address is left out, and so is `https://user:secret-value@example.test/beds.mp4`. The description `Beds` stays. The stored address stays on the clip. `npx vitest run tests/slide-html.test.ts` passed (7 tests) at 02:30:22. The HTML file was not opened. The slideshow was not opened. This is not a WCAG conformance claim.

2026-11-02: a pie percent uses only finite amounts. `10` and a value that is not a number are `100%` and `0%`. A value that is not finite is `0%`. The label is not `NaN%`. Finite amounts that are greater than zero still add to 100. `npx vitest run tests/pptx-chart-svg.test.ts -t "centers pie percents"` passed (1 test) at 04:52:27. The chart was not opened. The slideshow was not opened. This is not a WCAG conformance claim.

2026-11-02: a line chart keeps a missing number in its own category. `2013` stays on `8.43`, `2014` is the gap, and `2015` stays on `16.40`. The line is two pieces. The drawing does not contain `NaN` or `secret-value`. `npx vitest run tests/pptx-chart-line.test.ts tests/pptx-chart-svg.test.ts tests/combo-chart.test.ts` passed (27 tests) at 06:27:24. The chart was not opened. The slideshow was not opened. This is not a WCAG conformance claim.

2026-11-04: Completed verification of all 4 acceptance criteria across 17 Vitest test suites (78 tests). Verified master inheritance and overrides for layout/colors/fonts/placeholders; geometry alignment, grouping, snapping, and locking; inspectable reading order and alt-text preservation across PPTX import/export; and consistent animation preview and playback sequencing across preview panes, slideshows, and multi-display presenter screens. Status marked done. Unblocks WP-024.

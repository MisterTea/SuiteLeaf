# 94 · See the margin and the reason

**Mode:** single-node · **App:** Docs · **Video:** [videos/94-see-the-margin-and-the-reason.mp4](videos/94-see-the-margin-and-the-reason.mp4) · **Script:** [scenes/94-see-the-margin-and-the-reason.spec.ts](scenes/94-see-the-margin-and-the-reason.spec.ts)

## Who and why

Sam sets the footer distance past the margin. The dialog explains that the notes moved up, and in the same glance she can see that Bottom is still 1 inch. She applies without scrolling.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup is a short dialog. Every field and OK are on screen together. It does not explain why the body moved.
- Storyboard [91](91-keep-the-letterhead-off-the-title.md) added the explanation. On an 800-pixel-tall window the footer note covered the bottom margin.
- The header distance, the footer distance, and the margin rules stay as they are. This story is only the dialog's fit.

## Scenes

1. **The reason.** Sam opens Page setup on "Minutes" and sets Footer from edge to 1.5 inches. The note appears under that distance. Bottom still reads 1 inch, on the same screen. She does not scroll.
2. **Too close.** Before that, 0.2 inches turns Apply off. The refusal sits under the footer distance, and Bottom stays visible.
3. **The buttons.** Apply and Cancel stay on screen. She applies. The footer moves, and the notes stop above it.
4. **The header too.** She sets Header from edge to 1.5 inches. That note and the Top field are both visible. Top still says 1 inch. Minutes starts below Town council.
5. **Inside the margin.** She sets Header from edge to 0.5 inches. Only the header moves up. Minutes stays at 1 inch.

## Google Workspace benchmark

Google's page setup fits on a laptop without scrolling ([Docs Help](https://support.google.com/docs/answer/10296618)). It never explains a collision, so the short dialog is the whole story. Ours explains the collision and keeps the margin it is talking about on screen.

## Better than Google Workspace when

1. On an 800-pixel-tall window, Footer from edge, its explanation, and the Bottom field are all visible at once. Nothing covers Bottom.
2. Header from edge, its explanation, and the Top field are all visible at once on that same window.
3. Apply and Cancel stay visible. Apply still commits a valid distance and stays off for a distance under 0.25 inches.
4. The margin values do not change when the distance is past the margin, and the body still moves clear of the header or footer.
5. On a phone-width screen every one of those fields can be reached. The laptop dialog must not require a scroll.
6. A half-inch header distance with a 1 inch margin still moves only the header.

## Success looks like

Sam reads "the footer is inside the text" and, in the same glance, sees Bottom still set to 1 inch. She applies without scrolling.

## Gaps and notes

- The explanation stays. Each distance sits on the same row as the margin it can collide with, and the note is the next line, so it cannot cover that field.
- There is no ruler, centimeter unit, or a separate distance for the first page or for odd and even pages.
- The recording stays at the storyboard's 1280×800 frame. A phone-width window in that frame left a gray void and the caption covered the dialog, so the phone reachability is the browser test, not a shot in the video.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Footer from edge, its explanation, and Bottom are visible at once. Nothing covers Bottom | Met | Video 0:19, the blue note is under Footer from edge and Bottom still reads 1. Browser test `page setup shows the margin and the reason together` checks they share a row, the note does not overlap Bottom, and a click hits the field. |
| 2. Header from edge, its explanation, and Top are visible at once | Met | Video 0:30, both notes are on screen and Top still reads 1. The same test checks the header pair. |
| 3. Apply and Cancel stay visible. Apply commits a valid distance and stays off under 0.25 inches | Met | Video 0:16, Apply is off at 0.2 inches. Video 0:22, Apply is on and she uses it. The test expects Apply disabled at 0.2 and enabled at 1.5, then reads the saved placement. |
| 4. Margins stay put when the distance is past the margin, and the body moves clear | Met | Video 0:19 and 0:30, Bottom and Top stay 1. Video 0:24, the notes stop above the footer. Video 0:32, Minutes starts below Town council. The test measures a larger inset and an unchanged 1 inch margin. |
| 5. A phone can reach every field. The laptop dialog does not scroll | Met | Video 0:19 and 0:30, the whole dialog is on screen. The scene asserts the dialog body does not scroll. Browser test `a phone-width page setup can scroll to every field` scrolls to Top, Bottom, both distances, the header, the footer, both notes, Apply, and Cancel at 390×640. |
| 6. A half-inch header distance with a 1 inch margin moves only the header | Met | Video 0:38, Town council sits near the top and Minutes stays below it. The test measures the header at 0.5 inches and the title at 1 inch. |

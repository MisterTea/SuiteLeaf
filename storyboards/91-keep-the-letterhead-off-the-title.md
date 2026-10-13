# 91 · Keep the letterhead off the title

**Mode:** single-node · **App:** Docs · **Video:** [videos/91-keep-the-letterhead-off-the-title.mp4](videos/91-keep-the-letterhead-off-the-title.mp4) · **Script:** [scenes/91-keep-the-letterhead-off-the-title.spec.ts](scenes/91-keep-the-letterhead-off-the-title.spec.ts)

## Who and why

Sam sets both the header distance and the top margin to 1 inch. "Town council" and the title "Minutes" land on the same line. The letterhead should sit in its own band, and the title should start underneath it.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): the header lives in the margin. When the header's own height reaches the body, Docs pushes the body down. People still get an overlap and no explanation when the numbers are close.
- Storyboard [84](84-header-from-the-edge.md) pushes the body only when the header distance is past the margin. When the two numbers are equal, the header and the first paragraph still share a line.
- Storyboard [87](87-keep-the-letterhead-distance.md) reads those distances from Word. This story is the gap between them.

## Scenes

1. **Its own band.** Sam opens "Minutes", sets a 1 inch margin, the header "Town council", and Header from edge to 1 inch. The note says the header reaches the text, so the title starts below it. The top margin still says 1 inch. "Town council" sits on its own line, an inch from the top. "Minutes" starts underneath.
2. **Room in the margin.** She sets Header from edge to 0.5 inches. The note goes away. "Town council" moves up. "Minutes" is at the 1 inch margin.
3. **Past the margin.** She sets Header from edge to 1.5 inches. The note says the header is inside the text, so the title moves down. The top margin still says 1 inch. "Minutes" starts below "Town council".
4. **The footer.** She puts the header back at 1 inch and fills the page. "Hearing notes" has its own line above the bottom edge. Footer from edge at 0.5 inches moves only the footer. At 1.5 inches the bottom margin still says 1 inch, the note says the footer is inside the text, and the notes stop above it.
5. **Save.** She sets both distances back to 1 inch and reopens the file. "Town council" is still above "Minutes". Page setup still shows Header 1, Footer 1, and both margins 1.

## Google Workspace benchmark

Google Docs draws the header in the top margin and starts the body below it ([Docs Help](https://support.google.com/docs/answer/10296618)). If the header is tall enough to cross the margin, the body moves, but a near-miss just overlaps, and nothing says which number caused it.

## Better than Google Workspace when

1. With Header from edge and the top margin both at 1 inch, a one-line header sits above the first paragraph. They do not share a line.
2. The header's top stays 1 inch from the page edge. The margin value stays 1 inch.
3. Header from edge at 0.5 inches, with a 1 inch margin, moves only the header. The first paragraph stays at 1 inch.
4. Header from edge past the margin still pushes the body clear of the header and says why. The margin does not change.
5. The footer follows the same rule against the bottom margin.
6. The separation survives save and reopen.

## Success looks like

"Town council" is on its own line, an inch from the top. "Minutes" starts under it. A half-inch header distance lifts only the letterhead.

## Gaps and notes

- A one-line header whose distance equals the margin takes that line, and the title starts below it. The margin number does not change.
- A distance that fits inside the margin, such as 0.5 inches of header in a 1 inch margin, still moves only the letterhead.
- There is no ruler, picture or tabs in the header, centimeter unit, or a separate distance for the first page or for odd and even pages.
- Storyboard 84's checked-in video still shows the earlier shared line. This story is what replaced it.
- A short page does not show the footer clearance until the notes reach the bottom.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. At 1 inch, a one-line header sits above the first paragraph | Met | Video 0:16, "Town council" is on its own line and "Minutes" starts underneath. Browser test `a one-line letterhead at the margin sits off the title` measures the title below the header. |
| 2. The header's top stays 1 inch from the edge. The margin stays 1 inch | Met | Video 0:14, Header from edge and Top are both 1. Video 0:16, the letterhead is an inch down. Video 1:01, both are still 1 after reopen. The test reads `headerFromEdge` and `marginTop` as 96. |
| 3. Header from edge at 0.5 inches moves only the header. The first paragraph stays at 1 inch | Met | Video 0:20, the field is 0.5 and the reaches note is gone. Video 0:22, "Town council" is higher and "Minutes" is at the margin. The test measures the header at 0.5 in and the title at 1 in. |
| 4. A distance past the margin pushes the body and says why. The margin does not change | Met | Video 0:26, the blue note and Top still 1. Video 0:29, "Minutes" starts below the header. The test checks the top inset grew and the top margin stayed 1. |
| 5. The footer follows the same rule against the bottom margin | Met | Video 0:36, "Hearing notes" has its own line. Video 0:41, 0.5 inches moves only the footer. Video 0:45, Bottom is still 1. Video 0:49, the footer note says the text moves up. The test measures the footer at 0.5 in with a 1 inch bottom inset, then at 1.5 in with a larger inset. |
| 6. The separation survives save and reopen | Met | Video 0:58, "Town council" is still above "Minutes". Video 1:01, Header, Footer, Top, and Bottom are 1. The test reads those values from the saved file and measures the title below the header after reopen. |

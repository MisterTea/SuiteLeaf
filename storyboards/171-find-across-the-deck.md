# Find across the deck

Who: Nia has three slides. "Market" is on the first slide and again on the third. She is looking at the second slide and wants to jump to each Market without scanning the filmstrip.

Inspired by: Google Slides' Find, which opens a bar that can cover the match. It does not say which slide the match is on, and the next match is easy to miss when it changes slides.

## Scenes

1. Nia is on the middle slide, "Prices". She opens Find and types Market. The deck jumps to the first slide, the word Market is visible and not covered by the find bar, and the bar says 1 of 2 on Welcome.
2. She chooses next. The deck shows the third slide, Thanks, with Market visible, and the bar says 2 of 2 on Thanks.
3. She chooses next again. It wraps to the first Market, still 1 of 2 on Welcome.
4. She searches for "zzzz". The bar says no matches, and she stays on the current slide. The words on the slides do not change.
5. A skipped slide that contains Market is still found in the editor. Presenting still skips that slide.

## Google Workspace benchmark

- Slides can find text, but the bar often sits on top of the match.
- The bar does not name the slide.
- Find during editing and the skipped-slide rule are easy to confuse, so a match on a skipped slide can seem missing.

## Better than Google Workspace when

1. Find is one field. Typing Market jumps to the first match and the bar says 1 of 2 and the slide's place, Welcome. The find bar does not cover the word.
2. Next goes to the second Market on Thanks and says 2 of 2. Next again wraps to the first.
3. A search with no matches says there are none and does not change the slide text.
4. The match is case-insensitive. "market" finds "Market".
5. A skipped slide that contains the word is still found while editing. Presenting still skips that slide.
6. Zoom, slide numbers, and the stored words do not change.
7. Closing Find leaves the current slide where the last match was.

## Success

- Nia finds both Markets, sees which slide each one is on, and the word is not hidden behind the bar.

## Gaps

- `Slides.tsx` has no find field. A search for a find command in the slides editor finds only list lookups.
- Nothing walks the deck's text boxes for a word and moves to that slide.

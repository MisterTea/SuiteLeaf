# Replace across the deck

Who: Nia found "Market" on the first slide and the third. She wants the first one to become "Bazaar", then both of them, without changing "Prices" or the box positions.

Inspired by: Google Slides' Replace and Replace all, which sit in the find bar. Replace all does not say how many words will change before she clicks, and the bar can cover the word being replaced.

## Scenes

1. Nia is on the middle slide. She finds Market. The bar says 1 of 2 on Welcome, and the word is not covered. She types Bazaar in the replace field. Replace says it will change this match. One click. Welcome now says Bazaar. Thanks still says Market. The bar moves to the remaining match and says 1 of 1 on Thanks.
2. She chooses Replace all. The button already said Replace all 1. Thanks becomes Bazaar. The bar says 1 replaced. Prices is unchanged. The boxes have not moved.
3. She finds Market again. The bar says no matches.
4. She saves, returns home, and reopens. Both slides say Bazaar. Prices still says Prices.
5. A skipped slide that contained Market is also replaced when she uses Replace all, and presenting still skips that slide.

## Google Workspace benchmark

- Slides can replace across slides, but Replace all does not show the count first.
- The bar can cover the match.
- It is unclear whether a skipped slide's text changes.

## Better than Google Workspace when

1. Replace and Replace all sit in the find bar, which does not cover the word. Replace all shows the count before the click, such as Replace all 2.
2. Replace changes only the current match, keeps the other Market, and moves to the remaining match.
3. Replace all changes every remaining match and says how many it changed. Other words stay.
4. Matching stays case-insensitive, and the replacement keeps the capitalization she typed. "Bazaar" replaces "Market" as Bazaar, not MARKET.
5. A skipped slide's text is replaced in the editor. Presenting still skips that slide.
6. Save and reopen keep the new words. Box positions, zoom, and slide numbers do not change.
7. A search with no matches does not change any text, and Replace all is not offered.

## Success

- Nia changes one Market, then the rest, and Prices stays Prices.

## Gaps

- `slide-find.ts` lists matches and does not change the text.
- The find bar has no replace field and no Replace all count.

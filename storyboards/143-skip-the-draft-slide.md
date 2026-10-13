# Skip the draft slide

Who: Nia has three slides: Welcome, a draft called "Prices", and Thanks. She wants to present Welcome and then Thanks, and keep Prices in the deck so she can finish it later.

Inspired by: Google Slides' Skip slide. A skipped slide is only greyed in the filmstrip. The present button does not say that one slide will be left out, and you discover the skip in the middle of the show.

## Scenes

1. Nia opens a three-slide deck: Welcome, Prices, Thanks. Prices still has its title and a note. She chooses Skip slide on Prices. Prices stays in the filmstrip and is labeled Skipped. Welcome and Thanks are not.
2. Before she presents, the present control says the show is 2 slides, with 1 skipped.
3. She presents from the start. The first slide is Welcome. The next advance shows Thanks. Prices never appears. Speaker notes on Welcome still show if she opens them.
4. She leaves the show and chooses Unskip on Prices. The Skipped label is gone. The present control says 3 slides.
5. She presents again. Welcome, then Prices, then Thanks.
6. She skips Prices again, saves, returns home, and reopens. Prices is still labeled Skipped, its title and note are still there, and a show from the start goes Welcome then Thanks.

## Google Workspace benchmark

- Slides can skip a slide, but the filmstrip only greys it. The word "Skipped" is not on the thumbnail.
- The Present button does not say how many slides the audience will see.
- Starting the show on a skipped slide still opens that slide.

## Better than Google Workspace when

1. Skip slide is one control on the current slide. Prices stays in the filmstrip and is labeled Skipped. Welcome and Thanks are not labeled Skipped.
2. The present control says 2 slides, with 1 skipped, before the show starts.
3. A show from the start advances Welcome, then Thanks. Prices never appears. The title and note on Prices are still in the editor after the show.
4. Unskip removes the Skipped label. The present control says 3 slides. The next show includes Prices between Welcome and Thanks.
5. Starting a show while Prices is the current slide begins on Thanks, the next slide that is not skipped, and does not open Prices.
6. Save and reopen keep Prices skipped, keep its title and note, and a show still goes Welcome then Thanks.
7. Skipping does not change slide order, grouping, or the words on any slide.

## Success

- Nia presents Welcome and Thanks, and Prices waits in the deck labeled Skipped.

## Gaps

- `slideSchema` in `packages/core/src/index.ts` has no skipped flag.
- `moveShowCursor` in `apps/web/src/editors/slide-fade-in.ts` advances by index through `slideOrder`. It does not skip a slide.

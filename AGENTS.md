# Agent notes

Keep each TypeScript file under 1,000 lines.

## Building

When asked to build the app, run `npm run build`, then `npm run package:desktop` so `/Applications/SuiteLeaf.app` is replaced with the new build. Report the version it installed, and whether SuiteLeaf was open and needs reopening.

## Tests

Keep unit test coverage above 90%. Use Vitest for behavior. A Playwright test is for something Vitest cannot see:

- Layout: positions, overlap, scrolling, and whether a control is actually on screen.
- The sheet grid and the slide canvas, which are painted rather than written as DOM text.
- Real typing in the document, including caret, selection, and browser-specific keys.
- Storyboard recordings.

Dialog text, page-number rules, import and export, and saved document state belong in `tests/**/*.test.ts` or a jsdom component test under `tests/ui/`. Do not add a browser spec that only opens the app to read a string the unit test already checks.

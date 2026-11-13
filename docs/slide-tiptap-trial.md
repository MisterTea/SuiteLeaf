# Slide text: Tiptap trial

The trial uses static schema serialization for inactive text boxes and creates a
Tiptap Editor only for the active box. Editing and static display share the same
schema, DOM serialization and CSS. It is lazy-loaded and opt-in; the default
editor and the desktop installation have not been switched.

## Try it

Run `npm run dev`, then open the displayed URL with `?slideText=tiptap` appended
and open a slide deck. For the development server used for this check:

<http://127.0.0.1:4173/?slideText=tiptap>

Open the same URL without the query parameter to compare the current editor.
Saved files retain SuiteLeaf's `TextRun[]` format; there is no file format migration.

## Implementation

- Standard Tiptap list and list-item nodes handle item splitting, list input,
  nesting and lifting. Markers are outside the editable text.
- The Office adapter retains marker glyphs, symbol fonts, picture bullets,
  paragraph properties, inline effects and atomic math in model attributes.
- A shared selection mapping translates between authored run offsets and
  ProseMirror positions for toolbar formatting and the existing slide undo stack.
- Only the selected text box has an Editor instance. Thumbnails, inactive boxes
  and presentation views use schema serialization without one.
- The existing Office painter still provides styles and marker geometry. This
  trial replaces editing behavior; it does not yet remove the Office renderer.
- Automatic-number metadata is now retained by the shared run normalizer.

## Checks on November 12, 2026

Chromium against the local development server, 1440×1000 viewport for the benchmark.
The synthetic deck has three slides with the indicated number of text boxes on
each slide. Heap figures were captured after garbage collection, before activating
an editor. Input latency measures `beforeinput` to the next animation frame, not
physical keyboard-to-display latency. Each row is one diagnostic sample, not a
statistical speed comparison or a production build benchmark.

| Boxes per slide | Editor | Open/import | Activate box | Input-to-frame p95 | Idle JS heap |
| --- | --- | --- | --- | --- | --- |
| 20 | Current | 1211 ms | 38.4 ms | 16.1 ms | 67.8 MB |
| 20 | Tiptap trial | 1395 ms | 45.1 ms | 17.2 ms | 77.1 MB |
| 100 | Current | 1181 ms | 65.8 ms | 15.9 ms | 67.1 MB |
| 100 | Tiptap trial | 1642 ms | 42.1 ms | 17.2 ms | 83.6 MB |

The trial had zero live editors before activation and exactly one after activation
in both deck sizes. Typing remained responsive; loading the trial added memory
and import overhead in this sample.

Validation:

- 12 edit/static geometry comparisons: six text styles at two viewport sizes.
  Visible character bounds matched within 0.01 CSS pixels, relative to each box.
  This checks mode consistency, not agreement with Microsoft PowerPoint.
- Real browser typing continued imported square bullets, nested and lifted items,
  survived slide undo/redo, and retained edits on re-entry.
- 123 related unit/component tests passed across the validation runs, including Office metadata conversion,
  formatted HTML lists, numeric numbering, selection mapping and editor lifecycle.
- Four browser tests passed, including the benchmark.
- New trial code has over 98% statement coverage and over 99% line coverage in the
  targeted coverage run. This is not a measurement of whole-repository coverage.

## Before making it the default

The trial intentionally uses browser wrapping in both modes. Full equivalence to
the existing Office soft-line wrapping and explicit tab-stop layout is unfinished.
First-item indentation and level-specific text colors are covered, including
outdenting after reopening the box and preserving explicit hyperlink colors.
Indentation also applies the destination level's body font size and restores it
on outdent. Imports retain sizes for unused levels; older saved decks infer sizes
from consistently authored body text. Special-size words and marker proportions
are preserved.
Alphabetic/Roman numbering, numbering restarts and other level-specific list style
changes need broader coverage. Composition input, remote-edit interactions,
clipboard interoperability and a representative imported PowerPoint corpus also
need validation. Layout checks covered ordinary bullets, nested symbol bullets,
mixed type sizes, kerning, rotation and autofit; they are not an Office-fidelity
certification.

## Reproduce

With the current source served on port 4173:

```sh
npx playwright test tests/browser/slide-tiptap.spec.ts --project=chromium
npx vitest run tests/ui/slide-tiptap-model.test.ts tests/ui/slide-tiptap-text.test.tsx
```

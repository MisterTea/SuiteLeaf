# 20 · Build a presentation

**Mode:** single-node · **App:** Slides · **Video:** [videos/20-build-a-presentation.mp4](videos/20-build-a-presentation.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

Priya volunteers at a community garden and has ten minutes to put together slides for Saturday's kickoff meeting. She has used Google Slides and PowerPoint and expects the same basics: a title slide, new slides from a layout menu, a splash of color, and dragging slides into order.

## Inspired by

- W12 Slides tutorial: multi-slide deck, layouts, backgrounds, shapes, reordering thumbnails ([docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md)).
- [Google Slides: Add, delete & organize slides](https://support.google.com/docs/answer/1694830): "New slide with layout", and reorder by dragging slides in the left panel.
- [Google Slides: change the theme, background, or layout](https://support.google.com/docs/answer/1705254): background for one slide or the whole deck, and Layout to rearrange a slide.

## Scenes

1. **New presentation.** From the home screen Priya clicks "New presentation". The file title box reads "Untitled presentation", and the title slide shows grey "Click to add title" and "Click to add subtitle" placeholders.
2. **Name it.** She types "Spring Garden Kickoff" in the file title box.
3. **Title slide.** She clicks each placeholder and types "Spring Garden Kickoff" and "Community Garden · Saturday 10 am". The placeholder text disappears as she types; nothing has to be selected and deleted first.
4. **Title & body.** "+ New slide" → "Title & body" adds slide 2 with empty title and text placeholders. She types "This season's plan" and three bullets.
5. **Change the layout.** She adds another Title & body slide and types "How you can help". Two lists would read better side by side, so with nothing selected she picks Layout → Two columns. Her title stays at the top and an empty second column appears. She types Saturday jobs on the left and May events on the right.
6. **Section header.** "+ New slide" → "Section header" adds a dark "Questions?" slide.
7. **Shape.** On the title slide she clicks Circle, which draws a round circle, sets Fill to Yellow, and drags it into the top-right corner as a sun.
8. **Background.** With nothing selected she picks Background → Sage green. The slide and its thumbnail turn soft green.
9. **Reorder.** She drags the "How you can help" thumbnail up. A blue line shows where it will land, and on release it sits before "This season's plan".
10. **Autosave.** The status reads "Saved on this device".

## Success looks like

- Four slides in the order Title, How you can help, This season's plan, Questions?
- No stand-in text ("Slide Title", "First key point") anywhere: every box holds what Priya typed.
- The volunteer slide uses the Two columns layout, chosen after the slide was made.
- The title slide has a sage background and a round yellow sun; the section slide is dark.
- The presentation saved itself without a Save button.

## Gaps and notes

Fixed in this pass:

- New slides used to contain real stand-in text ("Slide Title", "• First key point…", "Click to add subtitle", and the file name on a new deck's title slide) that had to be selected and retyped, and showed up in the slide show if skipped. Layout boxes are now empty placeholders: grey hint text in the editor, nothing in thumbnails, the slide show, or exports.
- Layout on an existing slide used to change nothing visible. It now moves the slide's title and text into the new layout's boxes, adds empty placeholders for new boxes, and adds text that no longer has a box to the last one so nothing is lost. Shapes, images, and text boxes Priya added herself stay where they are. Section header switches the background to dark, and switching away restores it.
- Slides can now be reordered by dragging thumbnails (with a blue drop line), and with Ctrl/Cmd+Up/Down when the slide list has focus. Up/Down without a modifier moves the selection. The Move slide up/down buttons remain.
- Theme now applies to every slide (section headers keep their dark accent on light themes), and Background has "Apply to all slides". Both switch text that would become unreadable to a light or dark color, as does choosing a dark background for one slide.
- "Circle" used to draw a wide oval; it now draws a circle. Fill gains strong colors (Blue, Green, Yellow, Red, Dark) next to the pastels, now named "Light blue" and so on.
- Controls that did nothing are no longer offered: the Line tool, Transition, Grid view, the Menus search button, the Zoom dropdown, the rotate handle on selected items, and the dropdown arrow on the toolbar's Slideshow button.

Still open:

- No line or arrow shapes, slide transitions, grid (slide sorter) view, menu search, or zoom. Zoom needs slide text to scale with the canvas first: text is sized in fixed pixels, so it doesn't shrink with smaller windows.
- A new shape still lands at a fixed spot (often on top of the title) and has to be dragged clear; Google Slides lets you draw it where you want it. Fill has no custom color picker.
- Bullets are typed by hand ("• "); the body placeholder doesn't add bullets as you type, and the Bullet list button only toggles a flag.
- Adding shapes or text boxes, typing, and moving items don't create undo steps (only slide-level changes such as new slides, layouts, backgrounds, and reordering do), so Undo can jump back further than expected.
- Layout changes treat the slide's text boxes in order (title first). A slide imported from PowerPoint, which has no placeholder markers, maps all of its text boxes this way.
- The editor shows two Slideshow buttons (one in the header, one in the toolbar).

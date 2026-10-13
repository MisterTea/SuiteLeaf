# 32 · Give a deck a theme and transitions

**Mode:** single-node · **App:** Slides · **Video:** [videos/32-give-a-deck-a-theme-and-transitions.mp4](videos/32-give-a-deck-a-theme-and-transitions.mp4) · **Script:** [scenes/32-give-a-deck-a-theme-and-transitions.spec.ts](scenes/32-give-a-deck-a-theme-and-transitions.spec.ts)

## Who and why

Dev is making a 10-slide pitch for the community centre's fundraiser. The slides were written quickly in plain black and white, and some text boxes got their own fonts along the way. Dev wants one look across the whole deck: the centre's green, one heading font, and one body font. New slides should come out matching, and changing the theme later should restyle everything. A gentle fade between slides would be nice, as long as it doesn't take an afternoon.

## Inspired by

- WF-A1-15 and WF-A2-14 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): choose a theme, "theme restyles"; transitions, animations, and slide master are "out-of-v1/partial".
- [Skywork: change the default font in Google Slides](https://skywork.ai/blog/how-to-change-default-font-google-slides-template-guide/): theme fonts only reach placeholders, so free text boxes and manual formatting ignore them.
- [Aurascience: apply a theme to all slides](https://www.aurascience.blog/apply-theme-to-all-slides-google-slides): "stubborn" slides keep their old background or font until they're reset.
- [Docs Editors Community: master font size changes not applied to new slides](https://support.google.com/docs/thread/140377652/changes-to-font-size-in-the-master-theme-slide-are-not-being-applied-to-newly-created-slides?hl=en).
- [r/GoogleSlides: "Google Slides is really the worst"](https://www.reddit.com/r/GoogleSlides/comments/1h18clf/rant_google_slides_is_really_the_worst/): "why can't the last animation I created be the default for the next one", and a third-party add-on just to change fonts and colours across a deck.
- [Docs Editors Community: take the animation off all slides at once](https://support.google.com/docs/thread/224589521/is-there-a-way-to-take-the-animation-off-of-all-the-slides-at-once?hl=en): "there isn't any way to bulk delete animation".

## Scenes

1. **Open the deck.** Dev opens "Fundraiser pitch". The slides are white with Arial text, and two text boxes use Georgia.
2. **Open themes.** Dev clicks **Theme** in the toolbar (also Slide › Change theme). A side panel shows theme cards, each a small title slide drawn with the theme's background, accent colour, heading font, and body font.
3. **Preview and apply.** Hovering "Meadow" (deep green, white headings in Montserrat, body text in Source Sans) previews it on the current slide. Moving away restores the slide. Clicking applies Meadow to every slide. Titles, body text, shapes, and the section slide all change, and the two Georgia text boxes switch to Source Sans too.
4. **Customize the theme.** Under "Customize", Dev changes the accent colour to the centre's green (#2E7D32) with a colour picker. Every shape and accent on every slide follows.
5. **Keep a deliberate exception.** On one slide Dev sets a quote in italic Georgia. A small "Overrides theme" marker appears in the Format panel with **Reset to theme**. Applying another theme later leaves this quote alone and restyles everything else.
6. **New slides match.** Cmd/Ctrl+M adds a "Title & body" slide that already uses Meadow's colours and fonts. So do the layouts under Slide › Apply layout.
7. **Add transitions.** Dev opens Slide › Transition. A panel offers None, Fade, Slide from right, and Push, with All slides already chosen and the duration at 0.4 s. Clicking Fade applies it to every slide (Apply to all slides does the same thing when a range is selected). Each thumbnail gets a small transition icon.
8. **Preview.** **Play** in the panel previews the fade on the current slide. The slideshow (Cmd/Ctrl+Enter) fades between every slide.
9. **Remove them all.** Dev decides it's too much for one section, selects slides 4 to 6, and sets None. Those slides cut, and the others still fade.
10. **Hand off.** Dev downloads the SuiteLeaf file. Opening it in a browser that already has the deck offers Keep both; the copy still has Meadow, the italic Georgia quote, and the same fades.

## Google Workspace benchmark

In Google Slides, picking a built-in theme takes 2 clicks (Theme, then a theme). Changing fonts and colours across the deck goes through Slide › Edit theme: select the master slide, edit its placeholders, then check each layout you use, which can be 10 or more clicks. A transition takes 4 to 5 clicks: Slide › Transition, pick the type, set the duration, then Apply to all slides ([TheWindowsClub](https://www.thewindowsclub.com/add-change-and-remove-transitions-in-google-slides)).

Known pain points:

- Theme fonts only reach placeholders. Free text boxes and manually formatted text keep their old style, and fixing them means Clear formatting or replacing boxes by hand ([Skywork](https://skywork.ai/blog/how-to-change-default-font-google-slides-template-guide/), [Aurascience](https://www.aurascience.blog/apply-theme-to-all-slides-google-slides)).
- Master edits don't always reach new slides ([Docs Community](https://support.google.com/docs/thread/140377652/changes-to-font-size-in-the-master-theme-slide-are-not-being-applied-to-newly-created-slides?hl=en)).
- Animations can't be removed in bulk, and the animation pane doesn't remember your last choice ([Docs Community](https://support.google.com/docs/thread/224589521/is-there-a-way-to-take-the-animation-off-of-all-the-slides-at-once?hl=en), [r/GoogleSlides](https://www.reddit.com/r/GoogleSlides/comments/1h18clf/rant_google_slides_is_really_the_worst/)).
- People install add-ons just to change fonts and colours across a deck ([r/GoogleSlides](https://www.reddit.com/r/GoogleSlides/comments/1h18clf/rant_google_slides_is_really_the_worst/)).

## Better than Google Workspace when

1. Applying a theme takes at most 2 clicks and changes background, text colours, heading font, body font, and accent colour on every slide.
2. Applying a theme also restyles free text boxes and shapes, not just placeholders, except elements explicitly marked as overriding the theme.
3. A theme's accent colour, heading font, and body font can be changed in the theme panel without opening a master editor, and every slide updates in one step.
4. Elements whose font or colour was set by hand show "Overrides theme" with a 1-click **Reset to theme**, and the next theme change leaves them alone.
5. New slides and newly inserted text boxes and shapes use the current theme's colours and fonts.
6. Setting one transition on every slide takes at most 3 clicks (Slide › Transition, type, Apply to all), and setting None on several selected slides takes at most 2 more.
7. The slideshow plays the chosen transition between slides, and with reduced motion turned on in the operating system, transitions become instant.
8. The theme, overrides, and transitions survive save and reopen, and the native file opens with them on another computer.

## Success looks like

- Every slide uses Meadow with the centre's green, except the deliberate quote.
- New slides match without any extra work, and the slideshow fades except across slides 4 to 6.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. A theme is at most 2 clicks and restyles every slide | Met | Video 0:07 hover, 0:11 Theme then Meadow. Titles, body, the section slide, and the shape all change. |
| 2. Free text boxes and shapes follow, except an explicit override | Met | Video 0:07 the Georgia note becomes Source Sans while hovering, and stays after the click. The quote set by hand does not. `tests/slide-theme.test.ts` |
| 3. Accent, heading font, and body font edit in the theme panel, in one step | Met | Video ~0:14 types `#2E7D32`; the shape and accent field follow. Heading and body font dropdowns are in the same panel. `tests/slide-theme.test.ts` and `tests/browser/slide-theme.spec.ts` |
| 4. "Overrides theme" and Reset to theme; the next theme leaves it alone | Met | Video ~0:16 the bar and Reset to theme. Ink restyles the line under the quote and leaves the quote in italic Georgia; Meadow comes back the same way. Reset is clicked in `tests/browser/slide-theme.spec.ts` |
| 5. New slides, text boxes, and shapes use the theme | Met | Video 0:24 Cmd+M, Slide › Apply layout › Section header, then a rectangle in the centre's green. `tests/slide-theme.test.ts` |
| 6. One transition on every slide in at most 3 clicks; None on a selection in at most 2 more | Met | Video ~0:30 Slide, Transition, Fade (All slides is already selected, duration 0.4 s). Shift-click slides 4–6, then None. |
| 7. The slideshow plays the transition; reduced motion is instant | Met | The scene asserts a fade into slide 2 and a cut into slide 4, then a fade into slide 7. `transitionMs` in `tests/slide-theme.test.ts` and the reduced-motion half of `tests/browser/slide-theme.spec.ts` |
| 8. Theme, overrides, and transitions survive save and reopen | Met | The scene reads the downloaded `.slslides` file, then Keep both opens that copy. Video ~0:40. |

## Gaps and notes

- Themes and transitions travel in the native `.slslides` file. PowerPoint export still does not exist; PPTX remains import-only (`packages/core/src/pptx.ts`).
- Transitions are between slides. Objects on a slide do not animate on their own.
- There is no separate slide-master editor. The theme panel is the control for background, fonts, and accent.
- Opening a downloaded file in the browser that already has that deck asks whether to replace it or keep both, instead of behaving like a second computer with an empty library.

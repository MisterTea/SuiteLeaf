# 47 · Save a slide theme and use it again

**Mode:** single-node · **App:** Slides · **Video:** [videos/47-save-a-slide-theme.mp4](videos/47-save-a-slide-theme.mp4) · **Script:** [scenes/47-save-a-slide-theme.spec.ts](scenes/47-save-a-slide-theme.spec.ts)

## Who and why

Dev already applied Meadow to "Fundraiser pitch" and set the accent to the centre's green, #2E7D32 (storyboard 32). Next week there is a second deck, "Spring classes", and it should start from that same look. Dev wants to save the look once and apply it there, without rebuilding the colors and fonts, and without a PowerPoint file.

## Inspired by

- WF-A2-14 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): a theme restyles the deck. A slide master is out of scope.
- Storyboard [32](32-give-a-deck-a-theme-and-transitions.md): four built-in themes, a custom accent and fonts on that deck, and free text boxes that follow the theme unless they override it.
- [Use a template or change the theme](https://support.google.com/docs/answer/1705254): Slide › Change theme › Import theme, then pick another presentation and a theme inside it.
- [Docs Editors Community: save a theme I imported](https://support.google.com/docs/thread/249785808/updating-a-google-slide-theme): after import, people still cannot save the result as a theme of their own.
- [Docs Editors Community: default fonts for every new deck](https://support.google.com/docs/thread/251596528/change-default-fonts-in-google-slides): the theme does not carry to the next file.

## Scenes

1. **The look to keep.** Dev opens "Fundraiser pitch". Theme shows Meadow with the accent #2E7D32, Montserrat headings, and Source Sans body text.
2. **Save it.** In the theme panel Dev clicks **Save to library**, types "Centre green", and confirms. That is the click on Save to library, the name, and Save: the name is visible in the panel's Library list immediately.
3. **It is still there later.** Dev closes the deck and opens "Spring classes", a plain Paper deck. Theme › Library lists "Centre green" after the reload.
4. **Apply it.** Clicking "Centre green" restyles every slide: background, heading font, body font, and the green accent. A free text box follows. A quote Dev already set in italic Georgia stays, with "Overrides theme".
5. **The first deck is a copy, not a link.** Dev changes the accent on "Spring classes" to a lighter green. "Fundraiser pitch" still uses #2E7D32. Changing "Centre green" is not required; the applied theme is stored on the deck.
6. **Built-ins remain.** Paper, Meadow, Ink, and Warm Sand are still in the panel. Applying Paper to a scratch slide still works.
7. **Hand off.** The downloaded "Spring classes" file opens on another computer with Centre green's colors and fonts, including the Georgia quote. The other computer's library does not need to contain "Centre green" for that file to look right.

## Google Workspace benchmark

Reusing a theme is Slide › Change theme › Import theme › double-click the other presentation › pick the theme › Import theme: about 5 clicks plus finding the file ([Docs Help](https://support.google.com/docs/answer/1705254)). There is no "save this theme" that then appears in every deck. The next file starts from a built-in theme again ([Docs Community](https://support.google.com/docs/thread/251596528/change-default-fonts-in-google-slides)).

Known pain points:

- Importing depends on keeping a donor presentation around, and the imported theme is still awkward to update ([Docs Community](https://support.google.com/docs/thread/249785808/updating-a-google-slide-theme)).
- A theme edited in one deck does not become the starting point of the next deck.
- People export to PowerPoint just to carry a theme, and the theme still needs a home in Slides afterwards.

## Better than Google Workspace when

1. Save to library stores the current theme, including a custom accent, heading font, and body font, under a typed name, in at most 3 clicks plus typing.
2. That name is listed in the theme panel of another deck on this computer after a reload.
3. Applying the saved theme takes at most 2 clicks and restyles every slide the way storyboard 32 does: background, text colors, heading font, body font, accent, and free text boxes, except elements marked "Overrides theme".
4. The applied theme is a copy on that deck. Editing one deck's accent does not change the other deck, and does not change the library entry.
5. Paper, Meadow, Ink, and Warm Sand stay in the panel and still apply.
6. A deck that uses the saved theme keeps it in the `.slslides` file, so another computer shows the same look without the library entry.

## Success looks like

- "Spring classes" uses Centre green, except the italic Georgia quote.
- "Fundraiser pitch" is still #2E7D32 after the second deck's accent changed.
- The downloaded file looks the same on a computer that has never saved "Centre green".

## Gaps and notes

- `DECK_THEMES` is four built-in themes in `slide-theme.ts`. Customizing the accent or fonts writes onto that deck's `theme`. `themeEdits` is a ref inside the open editor, so a custom Meadow does not appear in another deck.
- There is no library list and no Save to library. Applying a theme already restyles a deck (storyboard 32); this story adds a saved source for that same apply.
- PowerPoint export is still absent (`packages/core/src/pptx.ts` is import-only). This story does not add it. The theme travels in the native file of each deck it is applied to.
- Transitions are per deck (storyboard 32) and are not part of the saved theme.

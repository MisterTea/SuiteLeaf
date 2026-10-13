# 47 · Save a slide theme and use it again

**Mode:** single-node · **App:** Slides · **Video:** [videos/47-save-a-theme-for-another-deck.mp4](videos/47-save-a-theme-for-another-deck.mp4) · **Script:** [scenes/47-save-a-theme-for-another-deck.spec.ts](scenes/47-save-a-theme-for-another-deck.spec.ts)

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
5. **The first deck is a copy, not a link.** Dev changes the accent on "Spring classes" to a lighter green, #66BB6A. The library row still reads #2E7D32, and the panel says this deck has its own copy. "Fundraiser pitch" still uses #2E7D32. Applying "Centre green" again puts the saved green back on "Spring classes" only.
6. **Built-ins remain.** Paper, Meadow, Ink, and Warm Sand are still in the panel. Applying Paper to a one-slide "Scratch" deck turns its dark title slide white, with a Georgia heading.
7. **Hand off.** The downloaded "Spring classes" file opens after the library is cleared. The slides still use Centre green, including the cream italic Georgia quote, and the library says "No saved themes yet."

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
- The downloaded file looks the same when the library does not contain "Centre green".

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Save to library stores the accent and both fonts under a typed name, in at most 3 clicks plus typing | Met | Video ~0:08 Save to library, type "Centre green", Save. The row shows the name and #2E7D32. `tests/slide-theme-library.test.ts` |
| 2. That name is listed on another deck after a reload | Met | Video ~0:16, after reload, Spring classes (Paper) lists Centre green. `tests/browser/slide-theme-library.spec.ts` |
| 3. Applying it takes at most 2 clicks and restyles every slide, except "Overrides theme" | Met | Video ~0:18 one click. Saturday mornings, the free text, and the shape follow. ~0:22 the italic Georgia quote stays, with Overrides theme. |
| 4. The applied theme is a copy. Editing one deck does not change the other deck or the library entry | Met | Video ~0:25 accent #66BB6A on Spring classes; the library row stays #2E7D32. ~0:28 Fundraiser pitch is still #2E7D32. |
| 5. Paper, Meadow, Ink, and Warm Sand stay and still apply | Met | Video ~0:32 the four names, then Paper turns the scratch slide white with a Georgia heading. |
| 6. The deck keeps the theme in the `.slslides` file without the library entry | Met | Video ~0:41 the opened file is Centre green, the quote is still italic Georgia, and the library says "No saved themes yet." The scene reads the downloaded file. |

## Gaps and notes

- PowerPoint export is still absent (`packages/core/src/pptx.ts` is import-only). The theme travels in the `.slslides` file of each deck it is applied to.
- Transitions stay on the deck (storyboard 32). A saved theme does not include them, and applying one does not change them.
- The library is stored in this browser. It is not synced. Another computer gets the look from the file, not from the library.
- Saving the same name again replaces that library entry. A deck that already applied the theme keeps the copy it has.
- There is no slide-master editor. The theme panel is still the control for background, fonts, and accent.
- The recording clears the library and opens the downloaded file under a new id, so this browser does not ask whether to replace a copy it already has.

# 36 · Find any command

**Mode:** single-node · **App:** Docs, Sheets, Slides · **Video:** [videos/36-find-any-command.mp4](videos/36-find-any-command.mp4) · **Script:** [scenes/36-find-any-command.spec.ts](scenes/36-find-any-command.spec.ts)

## Who and why

Priya has used Google Workspace for years and has just switched to SuiteLeaf. She knows what she wants to do ("strikethrough", "freeze the top row", "duplicate this slide") but not where SuiteLeaf keeps it, and she'd rather type than hunt through menus. She also wants to learn the shortcuts for the things she does every day.

## Inspired by

- WF-B2-15 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): keyboard shortcuts.
- [Keyboard shortcuts for Google Docs](https://support.google.com/docs/answer/179738): Ctrl+/ lists shortcuts, and Alt+/ opens the tool finder ("formerly search the menus").
- [Docs Editors Help: Tool finder](https://support.google.com/docs/answer/13466905) and [Workspace Updates: Enhancing tool discovery (2023)](https://workspaceupdates.googleblog.com/2023/04/enhancing-tool-discovery-google-docs-sheets-slides%20.html): Help › Search the menus moved into a toolbar search box.
- [Workspace Updates: Improving the menus (2018)](https://workspaceupdates.googleblog.com/2018/02/improving-menus-in-google-docs-editors.html): items renamed and reordered across menus, so people's habits break.
- [Vivaldi Forum: shortcuts conflict on Google Docs](https://forum.vivaldi.net/topic/75314/keyboard-shortcuts-conflict-on-google-docs) and [r/firefox: heading shortcuts don't work in Google Docs](https://www.reddit.com/r/firefox/comments/idv2yv/shortcuts_in_google_docs_for_heading_doesnt_work/): shortcuts that collide with the browser or behave differently in it.

## Scenes

1. **Docs: search the menus.** In "Quarterly Report", Priya selects a phrase and presses Option+/ (Alt+/ on Windows). A search box opens over the menu bar. She types "strike". "Format › Strikethrough · ⌘⇧X" is the top result. She presses Enter, and the phrase is struck through.
2. **Plain words work.** She types "count". "Tools › Word count" comes up even though she didn't type "word". "page numbers" finds the page setup options.
3. **Unavailable commands explain themselves.** With nothing selected she types "link". "Insert › Link" appears greyed with "Select text to add a link".
4. **Shortcut list.** She presses ⌘/ (Ctrl+/ on Windows). A "Keyboard shortcuts" dialog lists Docs shortcuts grouped as Text formatting, Paragraphs, Editing, Navigation, and Files, with a search box. Keys are shown as ⌘, ⌥, and ⇧ on her Mac.
5. **Sheets.** In the "Sample budget" she clicks the toolbar's **Menus** pill, types "freeze", and picks "View › Freeze › 1 row". The header row freezes. ⌘/ shows the Sheets shortcut list, including the formula shortcuts.
6. **Slides.** In a deck, Option+/ then "dup" runs "Slide › Duplicate slide". Help › Keyboard shortcuts shows the filmstrip and slideshow keys (←/→, B, W, S, Esc).
7. **Recent commands.** Opening the search again with nothing typed lists her last few commands first.
8. **Every listed shortcut works.** She tries ⌘D in Slides and ⌘⇧X in Docs, as listed. Both do what the dialog says.

## Google Workspace benchmark

Google Docs, Sheets, and Slides all have a shortcuts dialog (Ctrl+/ or Help › Keyboard shortcuts, 2 clicks) and a tool finder (Alt+/, or the search box in the toolbar, 1 click). Running a command by name is Alt+/, typing, and Enter: 1 shortcut plus typing ([Tool finder](https://support.google.com/docs/answer/13466905)). Menus also open from the keyboard with Alt+F, Alt+E, and so on in Chrome ([Sheets shortcuts](https://support.google.com/docs/answer/181110)).

Known pain points:

- Commands move between releases. The 2018 menu changes renamed and reordered items, and in 2023 Search the menus moved out of Help into the toolbar ([2018](https://workspaceupdates.googleblog.com/2018/02/improving-menus-in-google-docs-editors.html), [2023](https://workspaceupdates.googleblog.com/2023/04/enhancing-tool-discovery-google-docs-sheets-slides%20.html)).
- Shortcuts collide with the browser, or differ between browsers and keyboard layouts ([Vivaldi Forum](https://forum.vivaldi.net/topic/75314/keyboard-shortcuts-conflict-on-google-docs), [r/firefox](https://www.reddit.com/r/firefox/comments/idv2yv/shortcuts_in_google_docs_for_heading_doesnt_work/)).
- Mac users need Fn for several shortcuts ([Slides shortcuts](https://support.google.com/docs/answer/1696717)).

## Better than Google Workspace when

1. In each of Docs, Sheets, and Slides, Cmd/Ctrl+/ and Help › Keyboard shortcuts open a searchable shortcuts dialog. It lists every shortcut shown in that app's menus, using the platform's key names (⌘ ⌥ ⇧ on a Mac, Ctrl Alt Shift elsewhere).
2. Option/Alt+/ and Help › Search the menus (and the Sheets **Menus** pill) open a command search. It lists matching commands from every menu with their menu path and shortcut, and Enter runs the highlighted one. A test can type "strike", press Enter, and see strikethrough applied.
3. The search matches common synonyms and Google Workspace names: "freeze", "word count", "comment", "duplicate slide", and "remove duplicates" each return the right command, or say plainly that SuiteLeaf doesn't have it yet.
4. Commands that can't run right now are listed greyed out with the reason, not hidden.
5. Every shortcut shown in a menu or in the dialog works when pressed, and every menu item does something. No menu item is a no-op, and items for features SuiteLeaf doesn't have are removed rather than left inert.
6. With an empty search box, the 5 most recently used commands are listed first.
7. The menu bar can be reached and used entirely from the keyboard: one shortcut focuses it, arrow keys move between menus and items, and Enter runs an item.

## Success looks like

- Priya ran a command by name in each app and found the shortcuts list in each app with the same key.
- Every shortcut she tried from the list worked.

## Gaps and notes

- **Word count, spelling, and remove duplicates are named in search and explained, not built.** Tools › Word count, spelling, and Data › Remove duplicates belong to storyboards [34](34-count-words-and-check-spelling.md) and [38](38-clean-up-messy-data.md). Search says SuiteLeaf doesn't have them yet.
- **Some Slides and Sheets menu items are still owned elsewhere.** Storyboard [31](31-rearrange-a-deck.md) still owns Insert › Text box, Image, and Shape, Format › Text, and Edit › Cut, Copy, and Paste. Storyboard [39](39-insert-a-function-with-help.md) still owns Insert › Function and the Σ button. Those items stay in the menus and search lists them as not available yet. Slide › Duplicate, Delete, Undo, and Redo are wired to the editor functions that already existed.
- **Docs comments are not in this app yet.** Search for "comment" in Docs says so. Sheets › Cell comment is a real command.
- **Ctrl+Alt+M (and F10) focuses the menu bar** instead of Alt+letter, which collides with the browser. Arrow keys move between menus and items.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Cmd/Ctrl+/ and Help › Keyboard shortcuts open a searchable dialog in Docs, Sheets, and Slides, listing menu shortcuts with platform key names | Met | Video ~0:19 (Docs, ⌘⇧X), ~0:36 (Sheets formulas), ~0:42 (Slides slideshow and filmstrip). Test `36-find-any-command`. |
| 2. Option/Alt+/, Help › Search the menus, and the Sheets Menus pill run a command by name | Met | Video ~0:08 strike, ~0:32 freeze, ~0:39 dup. Browser test `command search runs strikethrough and explains commands that cannot run`. |
| 3. Synonyms and Google names find the command, or say it isn't in SuiteLeaf yet | Met | Video ~0:12 “count” → Word count (not yet), “page numbers” → Page setup; ~0:32 “freeze”; ~0:39 “dup”. Vitest `command search`. |
| 4. Commands that can't run are listed greyed, with the reason | Met | Video ~0:18 Insert › Link, “Select text to add a link”. |
| 5. Listed shortcuts work; inert Help and Extensions items are gone | Met for the shortcuts this storyboard owns | Video ~0:48 ⌘D duplicates a slide; ~0:51 ⌘⇧X strikes “The”. Cut, copy, paste, text formatting in Slides, spelling, and Insert Function remain for storyboards 31, 34, and 39. |
| 6. An empty search lists the last commands first | Met | Video ~0:45 Recent, Slide › Duplicate slide first. |
| 7. One shortcut focuses the menu bar; arrows move; Enter runs an item | Met | Video ~0:24 Ctrl+Alt+M, then ArrowRight and ArrowDown open Edit. |

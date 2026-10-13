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

- **Help › Keyboard shortcuts is broken in every app.** In Docs it opens Find and replace (`docActions.openFind`). In Sheets and Slides it's a no-op. Nothing handles Cmd/Ctrl+/.
- **The Sheets "Menus" pill does nothing.** The toolbar button titled "Search the menus (Option+/)" has `onClick={() => {}}`, and nothing listens for Option/Alt+/. Docs and Slides have no command search at all.
- **Many menu items are inert or mislabelled.** In `App.tsx` (integration at `44d7415`), these have `onSelect={() => {}}`:
  - Sheets: Insert › Function: SUM, Function: AVERAGE, and Link; Tools › Spelling, Autocomplete, and Notification settings; every Extensions item (Add-ons, Apps Script, AppSheet); Help › Sheets Help and Keyboard shortcuts.
  - Slides: every Edit item; Insert › Text box, Image, and Shape; Format › Text: Bold, Text: Italic, and Align & indent; Slide › Duplicate slide and Delete slide; Tools › Spelling and Preferences; Help › Keyboard shortcuts.
  - Docs: Tools › Spelling and grammar runs Clear formatting.
- **Shortcut labels are always Mac-style.** `MenuItem` shows the literal `shortcut` string ("Cmd+Z") on every platform. Several advertised shortcuts don't work in Slides (Cmd+Z, Y, X, C, V, B, I; see storyboard [31](31-rearrange-a-deck.md)).
- There's no list of commands to search. Menus are written inline as JSX in `App.tsx`, so a command palette and a shortcuts dialog need a shared command list (id, label, menu path, shortcut, enabled check, run) that the menus are built from.

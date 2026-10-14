# 148 · See the vote that changed

**Mode:** single-node · **App:** Docs · **Video:** [videos/148-see-the-vote-that-changed.mp4](videos/148-see-the-vote-that-changed.mp4) · **Script:** [scenes/148-see-the-vote-that-changed.spec.ts](scenes/148-see-the-vote-that-changed.spec.ts)

## Who and why

Maya changed the October minutes from compost to mulch and left the agenda alone. She opens version history while she is looking at the agenda. Today the compare only reads the first tab, so it can say nothing changed. She needs to see that the vote changed, and which tab it was on, before she decides whether to put the old wording back.

## Inspired by

- Storyboard [145](145-keep-the-agenda-and-the-minutes-together.md): each tab has its own text. Version compare still reads the first tab.
- Storyboard [44](44-compare-a-sheet-or-slide-version.md): a spreadsheet compare can move among worksheets. A document compare cannot move among tabs.
- [Find what's changed in a file](https://support.google.com/docs/answer/190843): version history highlights edits. It does not say which document tab they are on.

## Scenes

1. **Two tabs, one saved version.** Maya creates "October meeting". Agenda says "Call to order. Treasurer's report." Minutes says "Voted to buy compost." She saves a version she can return to.
2. **Only the vote changes.** On Minutes she replaces compost with mulch. Agenda is not edited. She saves again.
3. **History.** She opens version history and selects the earlier version. The summary says a paragraph changed, and it names **Minutes**. Agenda is not listed as changed.
4. **The wording.** She looks at Minutes in the compare. The old vote is struck and the new vote is marked as added. She looks at Agenda and the call to order has no strike or add.
5. **She does not restore.** She closes history. The live minutes still say mulch.

## Success looks like

- A change that exists only on a later tab is counted and named.
- The compare can show that tab and the unchanged tab.
- Closing history leaves the current text in place.
- A one-tab document still compares the way it does today.

## Better than Google Docs

- The history summary names the tab. She does not have to guess which part of the file moved.
- An unchanged tab is visibly unchanged, instead of a highlight that might belong to another tab.

## Gaps and notes

- Recorded. With Agenda on screen, version history of the earlier save says "1 paragraph changes on Minutes". Agenda is not named. The compare can show Minutes, with compost struck and mulch underlined, then Agenda with the call to order and no strike or add. Closing history leaves the live minutes saying mulch.
- Later tabs match by id. A tab only in the newer file is marked added, and a tab only in the older file is marked removed. The tab row appears when there is more than one tab. A one-tab document still compares `content` only, with no tab row.
- Two saves a few minutes apart still fold together, so the earlier one is under Show earlier autosaves. File › Save now is what stores the second snapshot; an edit inside the autosave gap does not. Restoring one paragraph still applies to the first tab. Restoring the whole version keeps every tab, because the snapshot is the whole file.

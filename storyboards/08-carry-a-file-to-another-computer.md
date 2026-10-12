# 08 · Carry a file to another computer

**Mode:** single-node · **App:** Docs · **Video:** [videos/08-carry-a-file-to-another-computer.mp4](videos/08-carry-a-file-to-another-computer.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Sofia writes a packing list in SuiteLeaf on her laptop's browser and wants to keep working on it at the office. There's no account or cloud sync in single-node mode, so she needs one file she can email to herself or put on a USB stick, and to be sure that file holds everything.

## Inspired by

- [web.dev: offline data](https://web.dev/learn/pwa/offline-data): browser storage stays on that device, and "users are always in charge, and they can delete the storage at any time".
- [r/chromeos: help me retrieve data deleted from local storage](https://www.reddit.com/r/chromeos/comments/1askfza/help_me_retrieve_data_deleted_from_local_storage/): someone cleared their browser data and lost work they had only saved in a site, with no way back.
- W4 and W14 (save, portability and round-trip) in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md), and "Saving and portability" in the [README](../README.md).

## Scenes

1. **Write.** Sofia makes "Lisbon trip packing list" with a Heading 1 and four bullet points. It autosaves in the browser.
2. **Download.** **Download** in the header (its tooltip names the file) saves "Lisbon trip packing list.sldoc", a single SuiteLeaf file. The save status then reads *Downloaded "Lisbon trip packing list.sldoc"*, so she knows what she got even if the browser saves it quietly.
3. **Remove it here.** Back on the home screen, she removes the list from the library. SuiteLeaf asks: *Delete "Lisbon trip packing list" from this browser? This can't be undone. A copy you downloaded isn't affected: open it again with Open / import.* (The browser's own confirm box isn't captured in recordings, so a caption shows its text.) The library is empty, like a computer that has never seen it.
4. **Open on the other computer.** **Open / import** with the .sldoc file opens it straight away, with the same title, the heading and all four items. The status says *Opened "Lisbon trip packing list.sldoc" · Saved on this device*.
5. **Keep going.** She adds "Sunglasses" to the list, and it saves on this computer.
6. **Open it again by mistake.** Later she opens the emailed file a second time. The list is already in this browser with newer changes, so instead of quietly making a copy SuiteLeaf asks: *"Lisbon trip packing list" is already in this browser*, shows when each was saved, warns that replacing discards the newer changes, and offers **Cancel**, **Replace** and **Keep both** (the safe choice is the main button). She cancels, and the list still ends with Sunglasses.

## Success looks like

- A single .sldoc file carries the whole document: title, heading and list.
- It's clear what Download made (name and type) and that removing from the browser leaves the downloaded copy as the only one.
- After import it's a normal editable file in the library again.
- Opening a file that's already in the library never silently duplicates or overwrites it: an identical file just opens the copy that's there, and a different version asks first, like Google Drive's "Replace existing file / Keep both".

## Gaps and notes

- Fixed while making this storyboard: Download gave no feedback in the app; the browser File menu listed the same download twice ("Download SuiteLeaf file" and "Export native copy"); it now says "Download SuiteLeaf file (.sldoc)" (or .slsheet / .slslides) and "Export native copy" only appears on desktop, where it differs from Save As. Re-importing a file still in the library made a "… copy" even when it was identical. The removal prompt didn't say what is lost or how to get it back, and the home screen's browser note now says "Download a file to back it up or move it."
- Removing is still permanent in the browser (no trash); that belongs with the library work in storyboard 02.
- **Replace** is refused while the file is open in another tab, so that tab can't save over it.

# 25 · When someone else saved first

**Mode:** cluster · **App:** Docs · **Video:** [videos/25-when-someone-else-saved-first.mp4](videos/25-when-someone-else-saved-first.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

Sam is writing the bake sale flyer in SuiteDrive. Jordan, on another computer, opens the same flyer, changes the time, and saves. Sam doesn't know and keeps typing. Neither of them should lose work silently. Sam wants to choose between keeping both versions and taking Jordan's.

## Inspired by

- W24 save and conflict semantics: conflicts preserve the draft, Save As writes elsewhere, and reload discards the draft ([docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md)).
- [Microsoft: Troubleshoot common coauthoring errors](https://support.microsoft.com/en-gb/office/troubleshoot-common-coauthoring-errors-f0a0be0c-c03f-45b2-bec0-535e5b13f691): "Upload Failed" offers Save a Copy or Discard Changes, and local work stays safe.
- [r/gsuite: Is Google Drive sync conflict resolution really this bad?](https://www.reddit.com/r/gsuite/comments/1rqlwk8/is_google_drive_sync_conflict_resolution_really/): last write wins and the loser is "silently" moved to version history, which people hate.

## Scenes

1. **Writing.** Sam signs in to the garden club's server, creates "Bake sale flyer" and types "Bake sale on Saturday, 10 am to noon." The status reads "Saved to SuiteDrive".
2. **Jordan saves first.** A caption explains that Jordan changes the time to "9 am to 1 pm" and saves from another computer. The recording simulates this by saving a new version through the SuiteDrive API, as another client would.
3. **Sam keeps typing.** Sam adds "All proceeds go to new raised beds."
4. **The banner.** A banner appears: "**This file was changed in SuiteDrive after you opened it.** A newer version was saved at 2:21 PM. Your edits weren't uploaded and are safe on this device. Save them as a copy to keep both versions, or reload the SuiteDrive version and discard your edits." The two choices sit together on the right, the safe one first: "Save as copy", then "Reload from SuiteDrive". The status reads "SuiteDrive has a newer version". Nothing was overwritten.
5. **Keep both.** Sam clicks "Save as copy". The status reads "Saved a copy to SuiteDrive" and the banner goes away.
6. **Name the copy.** The copy has the same name as the original, so Sam renames it "Bake sale flyer (Sam's draft)".
7. **Both in SuiteDrive.** Back in SuiteDrive there are two files: "Bake sale flyer.sldoc" (Jordan's) and "Bake sale flyer (Sam's draft).sldoc".
8. **Again, take theirs.** Sam opens Jordan's version, which shows the new time, "9 am to 1 pm", and starts adding "Bring a cake!" while Jordan saves another change. The banner returns.
9. **Reload.** Sam clicks "Reload from SuiteDrive". SuiteLeaf asks "Discard your edits and open the newer version from SuiteDrive? Your edits will be lost." and Sam confirms. The document shows Jordan's "Saturday 14 June, 9 am to 1 pm", without Sam's unsaved line, and the status reads "Saved to SuiteDrive".

## Success looks like

- No version was overwritten without Sam choosing.
- "Save as copy" kept both versions in SuiteDrive. "Reload from SuiteDrive" replaced the local edits with the newer version.

## Gaps and notes

- **Bug: "Save as copy" makes a file with the same name as the original.** The copy is created as "Bake sale flyer (copy).sldoc", but the upload that follows renames it to match the document's title, so SuiteDrive ends up with two "Bake sale flyer.sldoc" files side by side. The script works around this by renaming the copy's title. The copy should keep its "(copy)" name, for example by changing the document title too.
- **Bug: SuiteDrive documents stay cached in the browser after signing out.** Sam's flyer and copy remain in this browser's storage once he signs out, which matters on a shared computer.
- A conflict is only detected on Sam's next upload. If Sam stops typing, nothing says a newer version exists. There's no live update or "a newer version is available" notice. Adding one means polling SuiteDrive while a file is open, which touches the upload logic, so it is deferred.
- There's no way to compare the two versions, view the SuiteDrive version before choosing, or merge them. Word's "Resolve" steps through each change. Today Sam can only compare after "Save as copy", by opening both files.
- The banner says when the newer version was saved but not who saved it. SuiteDrive records the author's account ID for each version, but the app has no way to look up a name from it.
- "Reload from SuiteDrive" asks for confirmation with the browser's confirm pop-up, which doesn't appear in the recording, so a caption describes it. SuiteLeaf uses browser pop-ups for other confirmations too, such as "Reload saved" and naming a new folder.
- After "Save as copy", nothing on screen says Sam is now editing the copy rather than the original: the title is unchanged (see the first bug above) and the status only reads "Saved a copy to SuiteDrive".

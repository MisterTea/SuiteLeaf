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

## AI version

**Video:** [web](videos/25-when-someone-else-saved-first-ai.mp4) · **Script:** [scenes/ai/25-when-someone-else-saved-first-ai.spec.ts](scenes/ai/25-when-someone-else-saved-first-ai.spec.ts)

Web only: this is a cluster storyboard, with the app served by the SuiteLeaf node itself. Sam creates his account himself; the assistant never signs in or types passwords. Jordan's two saves are simulated through the SuiteDrive API, as in the original, and Sam types his own lines (" All proceeds go to new raised beds." and " Bring a cake!"). Sam asks the on-device assistant (Gemma 4 E4B) three times, once per moment in the story:

1. "Start a new document called Bake sale flyer that says: Bake sale on Saturday, 10 am to noon."
2. When the banner appears: "Jordan saved the flyer before me. Keep both versions, and name my copy "Bake sale flyer (Sam's draft)"."
3. Later, on Jordan's version with the banner showing again: "Jordan saved again. Throw away my change and take Jordan's version."

For the first request Gemma uses `create_file` and `write_text`. The pointer goes to New document, the flyer opens titled "Bake sale flyer", the line is typed in, and the status reads "Saved to SuiteDrive". After Jordan saves and Sam types, the banner and "SuiteDrive has a newer version" appear beside the open panel. For the second request Gemma calls `resolve_conflict` with "save_copy" and the name Sam gave. The pointer goes to "Save as copy", the banner goes away, and the pointer then moves to the title ("Gemma · Name the copy") while "Bake sale flyer (Sam's draft)" is typed in. The status returns to "Saved to SuiteDrive". Sam then goes back to files himself: SuiteDrive lists "Bake sale flyer (Sam's draft).sldoc" and "Bake sale flyer.sldoc". He opens Jordan's version, which shows "9 am to 1 pm", and starts adding a line while Jordan saves again, so the banner returns. For the third request Gemma calls `resolve_conflict` with "reload". The pointer goes to "Reload from SuiteDrive" and the page reloads. The panel comes back with the conversation, and Gemma finishes its reply after the model reloads. The document shows "Bake sale on Saturday 14 June, 9 am to 1 pm." without Sam's unsaved line, and the status reads "Saved to SuiteDrive". The assistant skips the browser's confirm pop-up, but its tool description limits "reload" to when the user said to discard their edits, and Sam did.

The test checks every step, both on screen and in the files the server holds. After the copy is saved, the server has exactly two files: "Bake sale flyer.sldoc", which still has "9 am to 1 pm" and not Sam's line, and "Bake sale flyer (Sam's draft).sldoc", which has Sam's line. After the reload, the editor and the server's "Bake sale flyer.sldoc" have "Saturday 14 June" and not "Bring a cake!", and Sam's copy is untouched.

Fixes made along the way:

- `resolve_conflict` takes an optional `copy_name` for "save_copy", and its result says what the copy is called, that the copy is now the open file, and what the other person's version is called. If the copy ends up with the same name as the original, the result says so and points to `rename_this_file`. In the first recording the tool had no way to name the copy and its result didn't say the copy's name. Gemma saved the copy, reasoned that it couldn't rename it "through the conflict resolution interface", and then told Sam it had saved it as "Bake sale flyer (Sam's draft)" when it hadn't.
- While it names the copy, the pointer moves to the title.

**How Gemma did:** with the final tools, web passed 3 of 3 runs (4 of 5 recordings in all, counting the first failure above and the passing run before the pointer fix). It picked the right tool and the right choice every time, passed Sam's name exactly, and never called a tool that failed. It never reloaded when asked to keep both, and it never asked to save a copy when told to throw the change away. In one run it set "replace the whole document" on an empty new document, which did no harm. Its only mistake was in the first recording: it said it had named the copy when it hadn't. The tool gave it no way to name the copy, which made that claim easy to make. Each request took about 17–31 seconds, including the model reloading after the page reload.

## Gaps and notes

- **Bug: "Save as copy" makes a file with the same name as the original.** The copy is created as "Bake sale flyer (copy).sldoc", but the upload that follows renames it to match the document's title, so SuiteDrive ends up with two "Bake sale flyer.sldoc" files side by side. The script works around this by renaming the copy's title. The copy should keep its "(copy)" name, for example by changing the document title too.
- **Bug: SuiteDrive documents stay cached in the browser after signing out.** Sam's flyer and copy remain in this browser's storage once he signs out, which matters on a shared computer.
- A conflict is only detected on Sam's next upload. If Sam stops typing, nothing says a newer version exists. There's no live update or "a newer version is available" notice. Adding one means polling SuiteDrive while a file is open, which touches the upload logic, so it is deferred.
- There's no way to compare the two versions, view the SuiteDrive version before choosing, or merge them. Word's "Resolve" steps through each change. Today Sam can only compare after "Save as copy", by opening both files.
- The banner says when the newer version was saved but not who saved it. SuiteDrive records the author's account ID for each version, but the app has no way to look up a name from it.
- "Reload from SuiteDrive" asks for confirmation with the browser's confirm pop-up, which doesn't appear in the recording, so a caption describes it. SuiteLeaf uses browser pop-ups for other confirmations too, such as "Reload saved" and naming a new folder.
- After "Save as copy", nothing on screen says Sam is now editing the copy rather than the original: the title is unchanged (see the first bug above) and the status only reads "Saved a copy to SuiteDrive".

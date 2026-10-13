# 60 · Comment on a slide

**Mode:** single-node · **App:** Slides · **Video:** [videos/60-comment-on-a-slide.mp4](videos/60-comment-on-a-slide.mp4) · **Script:** [scenes/60-comment-on-a-slide.spec.ts](scenes/60-comment-on-a-slide.spec.ts)

## Who and why

Maria is reviewing "Q3 update" before the meeting. On the chart slide she wants a note for Priya: "Use the September numbers." Docs already has comment threads. A slide has no comment control, so the note has nowhere to live except the speaker notes, which the audience can end up seeing.

## Inspired by

- [Comment in Google Slides](https://support.google.com/docs/answer/6504863): select an object or a slide, Ctrl/Cmd+Alt+M, type, Comment. A mark sits on the slide. Resolve hides it.
- Storyboard [29](29-comment-on-a-document.md): document comments already support add, reply, resolve, and reopen, and they survive save.
- Slide comments live in `apps/web/src/editors/slide-comments.ts`, on the object, not in the speaker notes.

## Scenes

1. **The deck.** Maria opens "Q3 update" on the chart slide. There is no comment mark. The speaker notes still say to point at September.
2. **Add a comment.** She selects the chart and presses Ctrl/Cmd+Alt+M. The box opens beside the chart, so the bars stay visible. She types "Use the September numbers", signs it as Maria, and posts. A mark appears on the chart.
3. **Reply.** In that same thread she adds "Priya has them." The reply sits under the first note, with her name.
4. **Another slide.** Next steps is clean, with its own speaker notes. Coming back shows the mark on the chart again.
5. **Resolve.** Resolve is a labeled button. The mark leaves the slide, and a line says where it went. Comments › Resolved shows the thread, and Reopen puts the mark back in one click.
6. **Save.** She reopens the file. Both notes are on the chart. The speaker notes are unchanged.

## Google Workspace benchmark

In Google Slides the path is select the object, Ctrl/Cmd+Alt+M, type, Comment ([Docs Help](https://support.google.com/docs/answer/6504863)). The comment card often covers the object it is about. Resolving is a check mark that is easy to miss, and a resolved comment is gone until you open the comment history.

## Better than Google Workspace when

1. Ctrl/Cmd+Alt+M on a selected object opens a comment box. The shortcut does not do nothing.
2. The posted comment is a mark on that object, not a speaker note.
3. A reply stays in the same thread, under the first note, with the author name.
4. Changing slides hides that mark. Returning to the slide shows it again.
5. Resolve removes the mark. A Resolved list can reopen it in one click.
6. The thread survives save and reopen on the same object.
7. The speaker notes are unchanged by the comment.

## Success looks like

The chart carries "Use the September numbers" and Maria's reply. The next slide is clean. Reopening the file brings the thread back on the chart, and the speaker notes still point at September.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Ctrl/Cmd+Alt+M on a selected object opens a comment box | Met | Video ~0:06. The Comment field is focused. `tests/browser/slide-comments.spec.ts` |
| 2. The posted comment is a mark on that object, not a speaker note | Met | Video ~0:09. The mark sits on the chart corner. Notes still start "Point at September". |
| 3. A reply stays in the same thread, under the first note, with the author name | Met | Video ~0:12. Maria, then "Priya has them." `tests/slide-comments.test.ts` |
| 4. Changing slides hides that mark. Returning shows it again | Met | Video ~0:15 next slide is clean; ~0:17 the mark is back. |
| 5. Resolve removes the mark. A Resolved list can reopen it in one click | Met | Video ~0:21 the mark is gone and the bar names Comments › Resolved; ~0:23 Reopen puts it back. |
| 6. The thread survives save and reopen on the same object | Met | Video ~0:28. Both notes are on the chart after the file is opened again. |
| 7. The speaker notes are unchanged by the comment | Met | Video ~0:09 and ~0:28. `tests/slide-comments.test.ts` round-trips the notes without the comment text. |

## Gaps and notes

- A comment is tied to one object on one slide. There is no PowerPoint comment round trip.
- The comment box sits beside the slide, so it does not cover the chart the way Google's card does. Resolve is a labeled button, and the bar above the slide says where a resolved thread went.
- Document comments, saved themes, and partial text formatting were left as they are.
- The recording caption covers the lower part of the speaker-notes field. The notes text itself is unchanged.

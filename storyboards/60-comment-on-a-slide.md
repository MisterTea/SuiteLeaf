# 60 · Comment on a slide

**Mode:** single-node · **App:** Slides · **Video:** [videos/60-comment-on-a-slide.mp4](videos/60-comment-on-a-slide.mp4) · **Script:** [scenes/60-comment-on-a-slide.spec.ts](scenes/60-comment-on-a-slide.spec.ts)

## Who and why

Maria is reviewing "Q3 update" before the meeting. On the chart slide she wants a note for Priya: "Use the September numbers." Docs already has comment threads. A slide has no comment control, so the note has nowhere to live except the speaker notes, which the audience can end up seeing.

## Inspired by

- [Comment in Google Slides](https://support.google.com/docs/answer/6504863): select an object or a slide, Ctrl/Cmd+Alt+M, type, Comment. A mark sits on the slide. Resolve hides it.
- Storyboard [29](29-comment-on-a-document.md): document comments already support add, reply, resolve, and reopen, and they survive save.
- `apps/web/src/editors/Slides.tsx` has no comment control.

## Scenes

1. **The deck.** Maria opens "Q3 update" on the chart slide. There is no comment mark.
2. **Add a comment.** She selects the chart and presses Ctrl/Cmd+Alt+M. A box asks for the note. She types "Use the September numbers" and posts. A mark appears on the chart.
3. **Reply.** She opens the mark and adds "Priya has them." The reply is under the first note, with her name.
4. **Another slide.** She moves to the next slide. The chart comment is not sitting on top of it. Coming back shows the mark again.
5. **Resolve.** She resolves the thread. The mark leaves the slide. Comments › Resolved shows it, and Reopen puts the mark back.
6. **Save.** She reopens the file. The reopened comment is on the chart, with both notes.

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

The chart slide carries "Use the September numbers" and Priya's reply. The next slide is clean. Reopening the file brings the thread back on the chart.

## Gaps and notes

- Slides have no comments. Docs already does.
- Do not rebuild document comments, themes, or partial text formatting.
- A comment is tied to one object on one slide. A full PowerPoint comment round trip is not required for this story.

# 61 · Fade in on click

**Mode:** single-node · **App:** Slides · **Video:** [videos/61-fade-in-on-click.mp4](videos/61-fade-in-on-click.mp4) · **Script:** [scenes/61-fade-in-on-click.spec.ts](scenes/61-fade-in-on-click.spec.ts)

## Who and why

Maria's chart slide already fades in as a whole slide, from storyboard 32. During the meeting she wants the "September" callout to stay hidden until she clicks, then appear. Google Slides can do that, but the animation pane is a long list of timings. She only needs one object to appear on the next click.

## Inspired by

- [Animate objects in Google Slides](https://support.google.com/docs/answer/1696483): select the object, Insert › Animation, choose Appear or Fade in, On click.
- People complain that the animation sidebar covers the slide and that "on click" and "after previous" are easy to mix up, so objects appear before the speaker is ready.
- `apps/web/src/editors/Slides.tsx` has slide-to-slide transitions and no per-object animation.

## Scenes

1. **The slide.** Maria opens "Q3 update". The chart and a "September" callout are both visible while she edits.
2. **On click.** She selects only the callout and chooses Insert › Animation › Fade in on click. An "On click" mark appears on September. The chart is not marked, and September stays readable.
3. **Present.** She starts the slideshow on this slide. The chart is visible. September is not.
4. **The click.** She clicks once. September fades in. The counter stays on slide 1. The next click advances to "What changed".
5. **Save.** She goes back to her files, opens "Q3 update" again, and presents. September still waits, and the next click fades it in without leaving the slide.

## Google Workspace benchmark

In Google Slides the path is select the object, Insert › Animation, pick Fade in, and set the trigger to On click ([Docs Help](https://support.google.com/docs/answer/1696483)). That is several clicks in a sidebar that covers the slide. The default trigger is often "on click", but adding a second animation can switch it to "after previous" without it being obvious.

## Better than Google Workspace when

1. Insert › Animation › Fade in on click applies to the selected object only. It takes at most 3 clicks after the object is selected.
2. While editing, the object stays visible so it can be changed.
3. In the slideshow, that object is hidden until the next click, and other objects on the slide are already visible.
4. The click that reveals it does not also advance the slide. The following click does.
5. An object without this animation is visible from the start of the slide.
6. The setting survives save and reopen.

## Success looks like

The chart is on screen when the slide opens. "September" appears on the next click, and only then. The slide after that still waits for another click.

## Gaps and notes

- One object can fade in on the next click. A timeline of delays, motion paths, and "after previous" is still not part of this story.
- Slide-to-slide transitions are unchanged.
- Turning the fade off is Undo. The menu item does not remove it.
- The fade is stored in the SuiteLeaf file. PowerPoint export does not write it as an animation.
- Themes, comments, and partial text formatting were left alone.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Insert › Animation › Fade in on click applies to the selected object only, in at most 3 clicks | Met | Video ~6–8s (Insert, Animation, Fade in on click). `fade in on click hides one object until the next slideshow click` and `marks only the selected object` |
| While editing, the object stays visible | Met | Video ~8–10s, September stays on the slide with an On click mark |
| In the slideshow the object is hidden until the next click, and other objects are already visible | Met | Video ~12–16s, chart and "Q3 update" are up, September is not, then it fades in |
| The click that reveals it does not advance the slide. The following click does | Met | Video ~15s still "Slide 1 of 2"; ~18s "What changed" / "Slide 2 of 2" |
| An object without this animation is visible from the start of the slide | Met | Video ~12s, the bars and "Sep" label are visible while September is hidden |
| The setting survives save and reopen | Met | Video ~21–25s, reopen and present, September waits again. Round-trip in `tests/slide-fade-in.test.ts` |

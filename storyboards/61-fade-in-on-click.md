# 61 · Fade in on click

**Mode:** single-node · **App:** Slides · **Video:** [videos/61-fade-in-on-click.mp4](videos/61-fade-in-on-click.mp4) · **Script:** [scenes/61-fade-in-on-click.spec.ts](scenes/61-fade-in-on-click.spec.ts)

## Who and why

Maria's chart slide already fades in as a whole slide, from storyboard 32. During the meeting she wants the "September" callout to stay hidden until she clicks, then appear. Google Slides can do that, but the animation pane is a long list of timings. She only needs one object to appear on the next click.

## Inspired by

- [Animate objects in Google Slides](https://support.google.com/docs/answer/1696483): select the object, Insert › Animation, choose Appear or Fade in, On click.
- People complain that the animation sidebar covers the slide and that "on click" and "after previous" are easy to mix up, so objects appear before the speaker is ready.
- `apps/web/src/editors/Slides.tsx` has slide-to-slide transitions and no per-object animation.

## Scenes

1. **The slide.** Maria opens "Q3 update" on the chart slide. The chart and a "September" callout are both visible while she edits.
2. **On click.** She selects only the callout and chooses Insert › Animation › Fade in on click. The callout is marked. The chart is not.
3. **Present.** She starts the slideshow on this slide. The chart is visible. The callout is not.
4. **The click.** She presses ArrowRight or clicks once. The callout fades in. The chart was already there. A second click advances to the next slide.
5. **Save.** She reopens the file and presents again. The callout still waits for the click.

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

- Slides can transition between slides. They cannot animate one object.
- One animation is enough. A timeline of delays, motion paths, and "after previous" is not part of this story.
- Do not rebuild themes, comments, or partial text formatting.

# 146 · Find the decision on the other tab

**Mode:** single-node · **App:** Docs · **Video:** [videos/146-find-the-decision-on-the-other-tab.mp4](videos/146-find-the-decision-on-the-other-tab.mp4) · **Script:** [scenes/146-find-the-decision-on-the-other-tab.spec.ts](scenes/146-find-the-decision-on-the-other-tab.spec.ts)

## Who and why

Maya put the vote on the Minutes tab and the agenda on the first tab. She later searches for "compost" while she is looking at the agenda. Find today only reads the tab she is on, and so does SuiteDrive search. The decision is in the file and she is told it is not there. Google Docs search can reach other tabs, but the hit does not say which tab it is in, so she still has to hunt.

## Inspired by

- Storyboard [145](145-keep-the-agenda-and-the-minutes-together.md): tabs keep their own text. Find, export, and SuiteDrive search still read the first tab only.
- [Find and replace in Google Docs](https://support.google.com/docs/answer/45892): find walks the document. It does not name the tab the match sits on.

## Scenes

1. **Two tabs.** Maya opens "October meeting". Agenda says "Call to order. Treasurer's report." Minutes says "Voted to buy compost." She is looking at Agenda.
2. **Find.** She opens Find and replace and types "compost".
3. **The other tab.** The Minutes tab becomes selected. "Voted to buy compost." is on the page, and the find bar says the match is on **Minutes**.
4. **The agenda is still there.** She clicks Agenda. The agenda text is back. "compost" is not on that page.

## Success looks like

- Find on the agenda tab locates a word that exists only on Minutes.
- The Minutes tab is selected, and the bar names that tab.
- Agenda is unchanged.
- SuiteDrive search and the library search also match words on later tabs. A hit names the tab.

## Better than Google Docs

- The find bar says which tab the word is on, instead of silently switching or making her guess.
- Search outside the document uses that same tab name, so a result is not just the file name.

## Gaps and notes

- Recorded. With Agenda open, Find for "compost" selects Minutes, shows "Voted to buy compost.", and the find bar says "on Minutes". Going back to Agenda still shows "Call to order. Treasurer's report."
- The on-this-computer library search matches text in `tabs`. SuiteDrive search does too. A hit that is only on a later tab is quoted as `Minutes: Voted to buy compost.` When the file has extra tabs, a hit on the first tab is quoted with that tab's name as well. A one-tab file is still quoted from `content`, with no tab prefix.
- Word, web page, and plain text export include every tab (see storyboard 147). Version compare counts a change on a later tab and names that tab (see storyboard 148). The assistant still searches the tab that is open.

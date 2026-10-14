# 147 · Take the whole meeting with you

**Mode:** single-node · **App:** Docs · **Video:** [videos/147-take-the-whole-meeting-with-you.mp4](videos/147-take-the-whole-meeting-with-you.mp4) · **Script:** [scenes/147-take-the-whole-meeting-with-you.spec.ts](scenes/147-take-the-whole-meeting-with-you.spec.ts)

## Who and why

Maya finished the October meeting. The agenda is on the first tab and the vote is on Minutes. She exports a copy for the club email while she is still looking at the agenda. Today that file contains only the agenda. The vote never leaves her laptop. She should not have to export once per tab, and she should be able to tell the two parts apart in the file she sends.

## Inspired by

- Storyboard [145](145-keep-the-agenda-and-the-minutes-together.md): tabs keep their own text. Word, web, and plain-text export still write only the open tab.
- Storyboard [146](146-find-the-decision-on-the-other-tab.md): find and search already see every tab.

## Scenes

1. **Both tabs.** Maya opens "October meeting". Agenda says "Call to order. Treasurer's report." Minutes says "Voted to buy compost." She leaves Agenda selected.
2. **Export.** She chooses File › Export TXT. She does not switch to Minutes first.
3. **The whole meeting.** The downloaded text contains Agenda, the call to order, Minutes, and the compost vote, in that order.
4. **The document is unchanged.** Agenda is still the selected tab. The vote is still only on Minutes.

## Success looks like

- Plain text, web page, and Word export include every tab, not only the one on screen.
- Each tab's name appears before its text, in tab order.
- Exporting does not switch tabs or mix the text inside the editor.

## Better than a one-tab download

- She exports once. She does not visit each tab and download again.
- The names Agenda and Minutes are in the file, so the vote is not an unlabeled second half.

## Gaps and notes

- Recorded. With Agenda selected, File › Export TXT downloads a file that contains Agenda, "Call to order", Minutes, and "compost", in that order. The script checks the download. Agenda stays selected, and the page still shows the call to order, not the compost vote.
- HTML and DOCX write the same two names and both sentences: a heading, then that tab's text. A one-tab file still named Document exports as the body alone, with no added heading. A one-tab file renamed away from Document includes that name.
- Page setup on the exported file comes from the first tab. Version compare counts a change on a later tab and names that tab (see storyboard 148). The assistant still searches the tab that is open.

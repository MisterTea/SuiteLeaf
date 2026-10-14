# 136 · Collect sign-ups at the table

**Mode:** single-node · **App:** Forms · **Video:** [videos/136-collect-sign-ups.mp4](videos/136-collect-sign-ups.mp4) · **Script:** [scenes/136-collect-sign-ups.spec.ts](scenes/136-collect-sign-ups.spec.ts)

## Who and why

Maya is at the garden club table with her laptop. She needs names and plot sizes before people leave. In Google Forms she would build the form, send a link, ask everyone to sign in, then open a different spreadsheet to see who signed up. That spreadsheet is easy to lose, and a missed required question only says "This is a required question." She wants to type each person's answers on this laptop and see the list immediately, in the same file.

## Inspired by

- WF-C1-01 and WF-C1-02 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): Google Forms questions, required fields, and a place to read the responses. Forms are listed as out of v1.
- [The Best Guide to Google Forms You'll Ever Find](https://www.makeuseof.com/wp-content/uploads/2017/09/The-Best-Guide-to-Google-Forms-You%E2%80%99ll-Ever-Find.pdf): the form and the response sheet are separate, and preview is another mode.
- [r/googlesheets: Google Forms responses not showing up](https://www.reddit.com/r/googlesheets/comments/1b0w0k0/google_forms_responses_not_showing_up/): people lose the link between the form and the sheet.

## Scenes

1. **A new form.** On the home screen Maya clicks **New form**. It opens as "Plot sign-ups". The page offers Questions, and it is empty except for a way to add the first question.
2. **The questions.** She adds "Your name" as short text and marks it required. She adds "Plot size" as one choice, with Small, Medium, and Large, and marks it required. She adds "Notes" as short text and leaves it optional.
3. **A missing answer.** She clicks **Add a response**. She types "Rosa" and leaves plot size empty. Submitting says **Plot size is required**. Nothing is added to the list.
4. **Rosa signs up.** She chooses Medium and types "Needs a sunny spot" under Notes. She submits. The form clears for the next person.
5. **The list is the same file.** She clicks **Responses**. One row shows Rosa, Medium, and "Needs a sunny spot". She does not open another file.
6. **Leo signs up.** She adds another response: Leo, Small, and no notes. Responses now has two rows. Questions still has the three questions.
7. **Take it home.** She downloads the SuiteLeaf file. The file holds the three questions and both responses.

## Success looks like

- Home has **New form**, and the form is a file of its own.
- Questions, Add a response, and Responses are in the same window.
- A required question that was skipped is named in the message.
- A submitted response shows up under Responses without a refresh or a second file.
- The downloaded file contains the questions and the answers.

## Better than Google Forms

- The questions and the answers are one file. Google keeps the answers in a separate spreadsheet.
- Maya types a response on this laptop. She does not send a link or ask anyone to sign in.
- The error names the question. Google says only that some required question was missed.
- Responses is one click away, and the new row is already there.

## Gaps and notes

- Recorded. New form, the three questions, the named "Plot size is required" message, Rosa and Leo on the Responses table, and the downloaded `.slform` all passed.
- There is still no public link, so people on another computer cannot fill the form themselves. Maya types the answers on this laptop.
- A question cannot be deleted or reordered after it is added.

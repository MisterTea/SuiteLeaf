# 26 · Sign out and go back to this computer

**Mode:** cluster → single-node · **App:** Home · **Video:** [videos/26-sign-out-and-disconnect.mp4](videos/26-sign-out-and-disconnect.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

Leo keeps a personal to-do list in SuiteLeaf on his computer and also uses the garden club's server for shared files. At the end of the day he wants to sign out of the server and go back to working on his computer alone. He wants his personal list untouched and the club's files left on the server.

## Inspired by

- README: **Server → Disconnect** returns the desktop app to single-node mode. Files on the computer are untouched, and SuiteDrive files stay on the server ([README.md](../README.md)).
- [Google Account Help: Stay signed in or out](https://support.google.com/accounts/answer/54490): sign out when you're done, especially on shared computers.
- [Google Account Help: Delete your Google Account information from a device](https://support.google.com/accounts/answer/4533068?hl=en): signing out of a shared device should leave nothing behind.
- Microsoft 365 and Google sign-out pages say "You signed out" so you know it worked. Office warns before you sign out with changes that haven't uploaded yet.

## Scenes

1. **Personal file.** Leo writes "Personal to-do" in single-node mode. It reads "Saved on this device".
2. **Connect.** He connects to the team server and creates an account.
3. **Shared file.** He creates "Shed inventory" in SuiteDrive. It reads "Saved to SuiteDrive".
4. **Separate lists.** SuiteDrive lists "Shed inventory.sldoc". His personal list isn't mixed in.
5. **Account card.** Under his name and the server's address are two labeled buttons: Sign out and Disconnect. Disconnect signs out and leaves the server in one step.
6. **Sign out.** He clicks Sign out. The sign-in card says "You signed out of ‹server›. Your SuiteDrive files stay on the server." The server's files are behind it.
7. **Back to this computer.** He clicks "Work on this computer without a server". The app returns to "Your workspace, in this browser." A notice says "Disconnected from ‹server› and signed out. Files in SuiteDrive stay on the server; connect again to open them."
8. **His files.** "Your files" lists "Personal to-do". "Shed inventory" isn't there, because it lives on the server. The browser no longer holds his sign-in.

## Success looks like

- Signing out says it worked and hides the server's files behind sign-in.
- Leaving the server says where he is now, returns to single-node mode with the personal file intact and no server files in the local list, and ends his session on the server.
- If a SuiteDrive file still has changes that haven't uploaded, Sign out and Disconnect ask first and name the file. Nothing is lost either way, because the changes stay on this device and upload when he signs in again and opens the file. With nothing waiting to upload, neither button asks.

## AI version

**Video:** [web](videos/26-sign-out-and-disconnect-ai.mp4) · **Script:** [scenes/ai/26-sign-out-and-disconnect-ai.spec.ts](scenes/ai/26-sign-out-and-disconnect-ai.spec.ts) (web only; cluster mode)

Leo writes "Personal to-do" on this computer, connects to the team server and creates his account himself, as in the original. Then he asks the on-device assistant (Gemma 4 E4B):

1. "Make a document called Shed inventory that says: 3 spades, 2 rakes, 1 wheelbarrow."
2. After checking SuiteDrive himself: "I'm done for today. Sign me out of the server and go back to working on this computer."

For the first request Gemma uses `create_file` and `write_text`, and the document reads "Saved to SuiteDrive". For the second it makes one call, `disconnect`, on SuiteDrive's home screen. The pointer goes to Disconnect under Leo's name. The page reloads into single-node mode, and the AI panel comes back with the whole conversation, including the finished Disconnect step. Gemma loads again and replies, for example "I have signed you out of the server and are back to working on this computer." The notice reads "Disconnected from ‹server› and signed out. Files in SuiteDrive stay on the server; connect again to open them." The test checks that notice and that "Your workspace, in this browser." shows. "Your files" lists "Personal to-do" and no "Shed inventory". The browser no longer holds the sign-in, and the server no longer recognizes the old session token. It also checks that the conversation carried on after the reload: the Disconnect step finished and Gemma's reply came last. If Gemma had signed out first, the test would also require the sign-in card to say "You signed out of ‹server›. Your SuiteDrive files stay on the server." In every run Gemma left in one step, so the sign-in card never appeared.

Fixes made along the way: the result Gemma got after disconnecting said "files now live on this computer". In the first run Gemma read that as SuiteDrive files having moved and replied "you are now working on the file locally". Now the result says Leo signed out and left the server, that SuiteLeaf is back to the files on this computer (listed after it), and that SuiteDrive files stayed on the server. If a SuiteDrive file had changes that hadn't uploaded and Leo answered Cancel to the warning, the agent's Disconnect used to wait forever. It also left a saved conversation behind, which would have resumed after a later reload. Now it asks before saving anything and tells Gemma that Leo chose to stay connected. `sign_out` now says the sign-in screen is showing and that the server's files are hidden until someone signs in.

**How Gemma did:** 4 of 4 web runs passed (3 of 3 with the final tools). It took two tool calls for the first request and one for the second, about 15–25 seconds per request, including reloading the model after the page reloaded. It never called `sign_out` and then the sign-in screen's Disconnect; it always chose the one-step `disconnect`, which does what Leo asked. No model mistakes were seen. Its closing replies were sometimes shorter than the result ("I signed you out of the server."), without mentioning that it had gone back to this computer.

## Gaps and notes

- Signing out and disconnecting hide SuiteDrive files but leave their cached copies in the browser's storage. The script checked: after these steps, a SuiteDrive document's text was still in the browser's IndexedDB. That keeps unsynced edits safe, but on a shared or public computer, the next person's browser profile still holds the file. There's no "remove this device's copies" option. (Being fixed separately.)
- Before this fix, Disconnect left the sign-in token in browser storage and never ended the session on the server. Connecting to the same server again signed the next person straight into Leo's account. Disconnect now signs out first. The app also drops any leftover sign-in when it starts in single-node mode, which covers the desktop app's **Server → Disconnect** menu.
- The "changes that haven't uploaded" warning is a browser confirm dialog, so it doesn't appear in the video. An automated test covers it (`tests/browser/suitedrive.spec.ts`).
- The desktop **Server → Disconnect** menu doesn't show the "Disconnected from…" notice or the unuploaded-changes warning, because the menu switches modes without asking the page. The sidebar's Disconnect button does both.

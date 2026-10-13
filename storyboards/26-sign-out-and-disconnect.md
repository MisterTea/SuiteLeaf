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

## Gaps and notes

- Signing out and disconnecting hide SuiteDrive files but leave their cached copies in the browser's storage. The script checked: after these steps, a SuiteDrive document's text was still in the browser's IndexedDB. That keeps unsynced edits safe, but on a shared or public computer, the next person's browser profile still holds the file. There's no "remove this device's copies" option. (Being fixed separately.)
- Before this fix, Disconnect left the sign-in token in browser storage and never ended the session on the server. Connecting to the same server again signed the next person straight into Leo's account. Disconnect now signs out first. The app also drops any leftover sign-in when it starts in single-node mode, which covers the desktop app's **Server → Disconnect** menu.
- The "changes that haven't uploaded" warning is a browser confirm dialog, so it doesn't appear in the video. An automated test covers it (`tests/browser/suitedrive.spec.ts`).
- The desktop **Server → Disconnect** menu doesn't show the "Disconnected from…" notice or the unuploaded-changes warning, because the menu switches modes without asking the page. The sidebar's Disconnect button does both.

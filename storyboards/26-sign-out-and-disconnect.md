# 26 · Sign out and go back to this computer

**Mode:** cluster → single-node · **App:** Home · **Video:** [videos/26-sign-out-and-disconnect.mp4](videos/26-sign-out-and-disconnect.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

Leo keeps a personal to-do list in SuiteLeaf on his computer and also uses the garden club's server for shared files. At the end of the day he wants to sign out of the server and go back to working on his computer alone. He wants his personal list untouched and the club's files left on the server.

## Inspired by

- README: **Server → Disconnect** returns the desktop app to single-node mode. Files on the computer are untouched, and SuiteDrive files stay on the server ([README.md](../README.md)).
- [Google Account Help: Stay signed in or out](https://support.google.com/accounts/answer/54490): sign out when you're done, especially on shared computers.
- [Google Account Help: Delete your Google Account information from a device](https://support.google.com/accounts/answer/4533068?hl=en): signing out of a shared device should leave nothing behind.

## Scenes

1. **Personal file.** Leo writes "Personal to-do" in single-node mode. It reads "Saved on this device".
2. **Connect.** He connects to the team server and creates an account.
3. **Shared file.** He creates "Shed inventory" in SuiteDrive. It reads "Saved to SuiteDrive".
4. **Separate lists.** SuiteDrive lists "Shed inventory.sldoc". His personal list isn't mixed in.
5. **Sign out.** He clicks Sign out next to his name. The sign-in card appears, and the server's files are behind it.
6. **Back to this computer.** He clicks "Work on this computer without a server". The app returns to "Your workspace, in this browser."
7. **His files.** "Your files" lists "Personal to-do". "Shed inventory" isn't there, because it lives on the server.

## Success looks like

- Signing out hides the server's files behind sign-in.
- Leaving the server returns to single-node mode with the personal file intact and no server files in the local list.

## Gaps and notes

- Signing out and disconnecting hide SuiteDrive files but leave their cached copies in the browser's storage. The script checked: after these steps, a SuiteDrive document's text was still in the browser's IndexedDB. That keeps unsynced edits safe, but on a shared or public computer, the next person's browser profile still holds the file. There's no "remove this device's copies" option.
- The web app has no Disconnect menu like the desktop app's Server → Disconnect. The sidebar's Disconnect button (plug icon) does the same thing in one step, but it has no text label.

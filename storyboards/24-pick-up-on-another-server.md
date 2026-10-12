# 24 · Pick up on another server

**Mode:** cluster (two servers) · **App:** Slides · **Video:** [videos/24-pick-up-on-another-server.mp4](videos/24-pick-up-on-another-server.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

The garden club runs two SuiteLeaf servers in one cluster: one at the office and one at the library. Priya starts a budget slide at the office, then that evening reaches the library server instead. She expects her account and her presentation to be there, just as OneDrive files show up on every computer.

## Inspired by

- README and architecture: servers in a cluster keep a fully synced copy of every account and file ([README.md](../README.md), [docs/architecture.md](../docs/architecture.md#nodes-suitedb-auth-and-suitedrive), [docs/suitedb.md](../docs/suitedb.md)).
- [Sync your computer's files and folders with OneDrive](https://support.microsoft.com/en-us/onedrive/sync-your-computer-s-files-and-folders-with-onedrive): get to your files from anywhere, and changes sync automatically.
- [Google Docs Editors Community: Google docs not updating](https://support.google.com/docs/thread/217159430/google-docs-not-updating?hl=en): people expect work saved on one device to appear on the next.

## Scenes

1. **At the office.** While the servers start, a caption sets the scene. Priya opens the office server and creates her account. The sign-in card says the server shares accounts and files with the organization's other servers.
2. **Which server.** On the home screen, the sidebar names the server ("Files are saved to SuiteDrive on …") and reads "Connected to 1 other server".
3. **Make a slide.** She creates a new presentation, names it "Budget update", and fills in the title slide. The top bar shows the office server's address next to a cloud icon, and the status reads "Saved to SuiteDrive".
4. **Switch servers.** That evening she opens the library server's address. It's a different address, so she sees its sign-in card with its own host name and the note that an account made on any of the organization's servers works here.
5. **Sign in.** She signs in with the email and password she created at the office.
6. **Her file is there.** SuiteDrive lists "Budget update.slslides", with the time she saved it at the office.
7. **Keep working.** She opens it. The top bar now shows the library server's address. She sees the subtitle she wrote at the office and adds "· Hoses $40". It saves to SuiteDrive on the library server.

## Success looks like

- One account works on both servers, and the sign-in card says so.
- She can always see which server she's on: in the sidebar on the home screen and in the top bar of the editor.
- The presentation saved on one server opens, with the same content, on the other, and new edits save there.

## Gaps and notes

- Sign-in is per server address, so moving between servers means signing in again. This is expected (sessions are per origin). The sign-in card now explains that the account is shared, but there's no single sign-on across the cluster.
- The sidebar shows how many other servers this one is connected to, and "Copying N files from other servers…" while file contents are still on their way. Items still copying show "Copying…" in the SuiteDrive list. While the home screen is open, the list refreshes in place when the server receives changes, so a file saved elsewhere appears without reloading.
- "Connected" doesn't promise the database has caught up: a server can't tell from its own state whether a peer has changes it hasn't pulled yet. The script still waits until both servers report the same database heads and nothing left to copy before switching. Showing "up to date as of …" would need the servers to compare heads with each other.
- There's no "Recent" or "Suggested" list across folders like Google Drive or OneDrive have. A file saved in a subfolder on another server has to be found by browsing. This needs a server endpoint for recently changed items, so it's left for later.
- The first seconds of the video are the two servers starting. The script shows an intro caption over the blank page meanwhile.

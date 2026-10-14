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

## AI version

**Video:** [web](videos/24-pick-up-on-another-server-ai.mp4) · **Script:** [scenes/ai/24-pick-up-on-another-server-ai.spec.ts](scenes/ai/24-pick-up-on-another-server-ai.spec.ts) (web only; cluster mode)

The script starts the same two clustered servers. Priya creates her account on the office server herself, then asks the on-device assistant (Gemma 4 E4B):

1. At the office: "Make a presentation called Budget update with a title slide: Budget update, and the subtitle Seeds $120 · Tools $85 · Compost $60."
2. That evening, on the library server, after signing in herself: "Open Budget update and add " · Hoses $40" to the end of the subtitle."

Gemma uses `create_file` and `set_slide_text` for the first request, and `open_file` and `set_slide_text` for the second. The pointer goes to New presentation, then to the title box while both boxes fill in. On the library server it goes to "Budget update.slslides" in SuiteDrive, and then to the subtitle, which gains " · Hoses $40". The top bar shows each server's address and "Saved to SuiteDrive". The test checks that the sign-in card says an account made on any server works there, that the sidebar names the server and reads "Connected to 1 other server", and that the editor's top bar names the office server and then the library server. It also checks the slide text on both servers and that the edit saves on the library server: after a reload the subtitle still reads "Seeds $120 · Tools $85 · Compost $60 · Hoses $40", and SuiteDrive has only one Budget update.

Fixes made along the way: with the AI panel open the editor's save status was cut off ("Saved to Suit…"). Now the file title gives way so the status stays readable. `set_slide_text` now points at the first box it changes (the subtitle here), not always the title. SuiteDrive's `open_file` and `open_folder` scroll the item into view before pointing at it. With the panel open the file list sits at the bottom edge of the home screen.

**How Gemma did:** 3 of 3 web runs passed with the final tools (6 of 6 overall), each in two tool calls per request and about 15–25 seconds per request. It always gave `create_file` the title and filled title and subtitle in one `set_slide_text`. For the edit it passed the old subtitle with " · Hoses $40" appended, leaving the title alone. No model mistakes were seen. Gemma opened the existing file rather than making a new one, and it did not call `back_to_files`.

## Gaps and notes

- Sign-in is per server address, so moving between servers means signing in again. This is expected (sessions are per origin). The sign-in card now explains that the account is shared, but there's no single sign-on across the cluster.
- The sidebar shows how many other servers this one is connected to, and "Copying N files from other servers…" while file contents are still on their way. Items still copying show "Copying…" in the SuiteDrive list. While the home screen is open, the list refreshes in place when the server receives changes, so a file saved elsewhere appears without reloading.
- "Connected" doesn't promise the database has caught up: a server can't tell from its own state whether a peer has changes it hasn't pulled yet. The script still waits until both servers report the same database heads and nothing left to copy before switching. Showing "up to date as of …" would need the servers to compare heads with each other.
- There's no "Recent" or "Suggested" list across folders like Google Drive or OneDrive have. A file saved in a subfolder on another server has to be found by browsing. This needs a server endpoint for recently changed items, so it's left for later.
- The first seconds of the video are the two servers starting. The script shows an intro caption over the blank page meanwhile.

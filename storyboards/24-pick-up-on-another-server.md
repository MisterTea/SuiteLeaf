# 24 · Pick up on another server

**Mode:** cluster (two servers) · **App:** Slides · **Video:** [videos/24-pick-up-on-another-server.mp4](videos/24-pick-up-on-another-server.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

The garden club runs two SuiteLeaf servers in one cluster: one at the office and one at the library. Priya starts a budget slide at the office, then that evening reaches the library server instead. She expects her account and her presentation to be there, just as OneDrive files show up on every computer.

## Inspired by

- README and architecture: servers in a cluster keep a fully synced copy of every account and file ([README.md](../README.md), [docs/architecture.md](../docs/architecture.md#nodes-suitedb-auth-and-suitedrive), [docs/suitedb.md](../docs/suitedb.md)).
- [Sync your computer's files and folders with OneDrive](https://support.microsoft.com/en-us/onedrive/sync-your-computer-s-files-and-folders-with-onedrive): get to your files from anywhere, and changes sync automatically.
- [Google Docs Editors Community: Google docs not updating](https://support.google.com/docs/thread/217159430/google-docs-not-updating?hl=en): people expect work saved on one device to appear on the next.

## Scenes

1. **At the office.** Priya opens the office server and creates her account.
2. **Make a slide.** She creates a new presentation, names it "Budget update", and fills in the title slide. The status reads "Saved to SuiteDrive".
3. **Switch servers.** That evening she opens the library server's address. It's a different address, so she sees its sign-in card with its own host name.
4. **Sign in.** She signs in with the email and password she created at the office. Her account was copied to this server.
5. **Her file is there.** SuiteDrive lists "Budget update.slslides".
6. **Keep working.** She opens it, sees the subtitle she wrote at the office, and adds "· Hoses $40". It saves to SuiteDrive on the library server.

## Success looks like

- One account works on both servers.
- The presentation saved on one server opens, with the same content, on the other, and new edits save there.

## Gaps and notes

- Sign-in is per server address, so moving between servers means signing in again. This is expected (sessions are per origin), but there's no hint that it's the same account on a different server.
- Neither server shows whether replication is up to date. The script waits until both servers report the same database heads and no files still replicating. A user who switched sooner could see an older list. Items still copying show a small "Replicating" icon, but there's no overall indicator.

# 22 · Connect to your team's server

**Mode:** single-node → cluster · **App:** Home · **Video:** [videos/22-connect-to-your-team-server.mp4](videos/22-connect-to-your-team-server.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

Leo has been using SuiteLeaf on his own, with files on his computer. The garden club now runs a SuiteLeaf server so everyone can share files. The coordinator sent him the address, and Leo wants to join without losing what's already on his computer.

## Inspired by

- README, "Cluster mode": a statically hosted web app starts in single-node mode, and **Connect to a server** switches it to cluster mode ([README.md](../README.md)).
- [Nextcloud desktop client: Initial setup](https://docs.nextcloud.com/server/stable/user_manual/en/desktop/installation.html): enter the server's URL, then log in or create an account.
- [r/selfhosted: Free office suite with multiuser?](https://www.reddit.com/r/selfhosted/comments/18gw4a0/free_office_suite_with_multiuser/): small groups want Google Docs-style sharing on their own server.

## Scenes

1. **Home on this computer.** Leo's own files ("Tomato planting notes", "Allotment wish list") are listed under Your files. The sidebar says "Your workspace, in this browser." with a "Connect to a server" button.
2. **Connect.** Leo clicks it. The "Connect to a SuiteLeaf server" dialog explains that files on this computer stay here.
3. **Server address.** He types the address he was given, without `http://`, and clicks Connect. SuiteLeaf tries `https://` first, then `http://`.
4. **Sign in.** The app reloads to a sign-in card showing the server's host name. It's his first time, so he clicks "Create an account".
5. **Create an account.** He enters his name, email, and a password, then clicks "Create account".
6. **Team home.** He lands on the team home screen ("YOUR TEAM WORKSPACE"). "Connect to a server" is gone.
7. **Who and where.** The sidebar shows his full name and the server, with labeled Sign out and Disconnect buttons. A note says files are saved to SuiteDrive on the server and that his files on this computer are kept for when he disconnects.
8. **SuiteDrive.** Below the New cards, SuiteDrive shows "This folder is empty." His local files are not mixed in.

## Success looks like

- The app is in cluster mode and signed in to the team server.
- The home screen lists SuiteDrive, and new files will be saved there.
- Leo can see who he's signed in as and which server he's on, and knows his local files are still on his computer.

## Gaps and notes

- An address without a scheme is tried with `https://` and then `http://`. The `http://` fallback is silent; the sign-in card shows only the host name, so it doesn't say whether the connection is encrypted.
- The SuiteDrive list sits below the New cards, so on a 1280×800 window it is mostly below the fold after signing in. The script scrolls to it.
- While connected, local files are hidden rather than listed separately. The sidebar note says they are kept, but there's no way to open one without disconnecting ([26](26-sign-out-and-disconnect.md)).
- The cluster home has no file search box; the single-node home does.
- Very long names still end in "…" in the sidebar. The full name, email, and server appear in its tooltip.
- The storyboard seeds Leo's two local files into browser storage before the first scene, so the empty home screen flashes for under a second at the start.

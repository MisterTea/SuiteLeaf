# 22 · Connect to your team's server

**Mode:** single-node → cluster · **App:** Home · **Video:** [videos/22-connect-to-your-team-server.mp4](videos/22-connect-to-your-team-server.mp4) · **Script:** [scenes/slides-cluster.spec.ts](scenes/slides-cluster.spec.ts)

## Who and why

Leo has been using SuiteLeaf on his own, with files on his computer. The garden club now runs a SuiteLeaf server so everyone can share files. The coordinator sent him the address, and Leo wants to join without losing what's already on his computer.

## Inspired by

- README, "Cluster mode": a statically hosted web app starts in single-node mode, and **Connect to a server** switches it to cluster mode ([README.md](../README.md)).
- [Nextcloud desktop client: Initial setup](https://docs.nextcloud.com/server/stable/user_manual/en/desktop/installation.html): enter the server's URL, then log in or create an account.
- [r/selfhosted: Free office suite with multiuser?](https://www.reddit.com/r/selfhosted/comments/18gw4a0/free_office_suite_with_multiuser/): small groups want Google Docs-style sharing on their own server.

## Scenes

1. **Home on this computer.** The sidebar says "Your workspace, in this browser." with a "Connect to a server" link.
2. **Connect.** Leo clicks it. The "Connect to a SuiteLeaf server" dialog explains that files on this computer stay put.
3. **Server address.** He types the address he was given and clicks Connect.
4. **Sign in.** The app reloads to a sign-in card showing the server's host name. It's his first time, so he clicks "Create an account".
5. **Create an account.** He enters his name, email, and a password, then clicks "Create account".
6. **SuiteDrive.** He lands on the team home screen ("YOUR TEAM WORKSPACE"). Below the New cards, SuiteDrive shows "This folder is empty."
7. **Who and where.** The sidebar shows his name and the server, with Sign out and Disconnect buttons. "Connect to a server" is gone.

## Success looks like

- The app is in cluster mode and signed in to the team server.
- The home screen lists SuiteDrive, and new files will be saved there.

## Gaps and notes

- The server address must include `http://` or `https://`. A bare host such as `suiteleaf.example.com` is rejected with "Enter a server address such as https://suiteleaf.example.com." Nextcloud's client accepts a bare host.
- In the sidebar, the account name is cut off ("Leo Ma…") when the Disconnect button is shown.
- The SuiteDrive list sits below the New cards, so on a 1280×800 window it is mostly below the fold after signing in.

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

## AI version

**Video:** [web](videos/22-connect-to-your-team-server-ai.mp4) · **Script:** [scenes/ai/22-connect-to-your-team-server-ai.spec.ts](scenes/ai/22-connect-to-your-team-server-ai.spec.ts)

The starting point is the same as above: Leo's two local files are in browser storage and a fresh team server is running. From the single-node home screen, Leo asks the on-device assistant (Gemma 4 E4B):

> The garden club has a SuiteLeaf server now. Connect me to it, the address is 127.0.0.1:&lt;port&gt;

The address has no `http://`, as in the original. Gemma calls `connect_to_server` with the bare address. In the recording, the pointer goes to "Connect to a server" in the sidebar, the address is tried with https and then http, and the page reloads onto the server's sign-in card. The assistant panel survives the reload with its transcript: the step shows as done ("Connected to the SuiteLeaf server at http://…"), and the panel says "Starting Gemma…" while the model loads again. Gemma then picks up the conversation and calls `wait_for_sign_in`. The pointer, labelled "Gemma · Waiting for you to sign in", sits just above the card so it doesn't cover the fields. Leo (the person, not the assistant) clicks "Create an account" and types his name, email and password. Once he is signed in, the pointer moves to his account chip ("Signed in"), and Gemma replies that he is connected to the garden club's server. Leo closes the panel, and the rest of the video follows the original: who and where in the sidebar, SuiteDrive below with "This folder is empty.", and no local files mixed in.

The test checks the original's end state: the saved mode is cluster with the server's URL, the user is signed in (Sign out shown), the home screen shows SuiteDrive and "YOUR TEAM WORKSPACE", the account chip shows "Leo Martins" and the host, "Connect to a server" is gone from the home screen, SuiteDrive shows "This folder is empty.", and "Tomato planting notes" is not listed. It also checks that the conversation carried on after the reload: `connect_to_server` succeeded, there are later steps, and the last item is a reply in words (not raw tool-call syntax).

Fixes made along the way:

- **Resume after reload:** tool call ids restarted at `call_1` on the reloaded page. The first call after the reload therefore had the same id as `connect_to_server`, and its result ("The user signed in.") was written onto the connect step, while `wait_for_sign_in` stayed spinning in the panel forever. Ids are now unique across reloads. Time spent before the reload now counts in the panel's run time (it showed "0s"). A resumed run also shows as busy while the reloaded page settles, instead of briefly looking idle with the send button enabled.
- **`wait_for_sign_in`:** the label reads "Waiting for you to sign in", so the panel tells the person what to do. The pointer used to sit on the first input and covered the Name and Email fields while Leo typed. It now sits above the card, and moves to the account chip after sign-in. The result now names the server, says new files go to SuiteDrive there and that files on this computer are kept, and includes the drive listing. The SuiteDrive snapshot says "still loading" instead of "empty" while the list loads, and the tool waits for the list before returning.
- **Parser:** once Gemma wrote `call:wait_for_sign_in{}<tool_call|>` without the opening `<|tool_call>` token. The call showed up as text in the panel and the run stopped. A reply that starts with `call:` is now read as a tool call (unit test in `tests/ai-gemma.test.ts`).

**How Gemma did:** with the final code, web passed 3 of 3 runs. Across all 6 recordings, Gemma connected with the bare address on its first call every time, and called `wait_for_sign_in` after the reload every time instead of asking Leo for a password. Mistakes seen: once it left out the opening tool-call token (now repaired by the parser). Once it narrated in the panel, "function_response … I will call `wait_for_sign_in` to pause execution", with a tool name and a made-up marker, before calling the tool. Its final replies are generic ("You are now connected to the garden club's SuiteLeaf server. What would you like to do?"). Only one run mentioned that My Drive is empty, and none passed on that his local files are kept, even though the tool result says so.

**Desktop:** not recorded (cluster storyboards are web only). In the desktop app, connecting goes through `window.suiteleaf.setMode`, which saves the mode and reloads the same window. That window keeps its `sessionStorage`, so the saved conversation should resume the same way.

## Gaps and notes

- An address without a scheme is tried with `https://` and then `http://`. The `http://` fallback is silent; the sign-in card shows only the host name, so it doesn't say whether the connection is encrypted.
- The SuiteDrive list sits below the New cards, so on a 1280×800 window it is mostly below the fold after signing in. The script scrolls to it.
- While connected, local files are hidden rather than listed separately. The sidebar note says they are kept, but there's no way to open one without disconnecting ([26](26-sign-out-and-disconnect.md)).
- The cluster home has no file search box; the single-node home does.
- Very long names still end in "…" in the sidebar. The full name, email, and server appear in its tooltip.
- The storyboard seeds Leo's two local files into browser storage before the first scene, so the empty home screen flashes for under a second at the start.
- The sign-in screen has no AI button. The panel stays open across the reload, but if Leo closes it while Gemma waits, he can't reopen it until he has signed in.
- After the reload the model loads again (about 10–15 s on WebGPU) before Gemma continues.

# SuiteLeaf Mail

Mail is available from **Mail** in a signed-in server workspace, at `/#/mail`.
It is unavailable in standalone mode. The web client never talks directly to
IMAP or SMTP; commands use the existing SuiteLeaf bearer session and Node auth
sidecar at `POST /api/auth/suiteleaf/mail`.

## Setup

1. Build the auth sidecar (`npm run build:auth`), web client and Rust server
   (`npm run build:web`, `npm run build:node`). Restart the server with these builds.
2. Open Mail → Mail settings or Connect email account.
3. Enter your display name, email, IMAP and SMTP hosts, ports, usernames and
   passwords/app passwords. IMAP commonly uses implicit TLS on 993; SMTP commonly
   uses STARTTLS on 587 or implicit TLS on 465. Both connections require TLS and
   valid certificates. No plaintext-password transport or certificate bypass is exposed.
4. Save tests both connections before storing the account. Blank passwords on
   subsequent edits retain the stored passwords.

Provider policies differ. Use **Connect with Google** for Gmail OAuth, then
**Continue to Google** to authorize in a browser. SuiteLeaf sign-in with Google
does not itself grant mailbox access. App passwords must be permitted by the provider.

### Google integration

Configure `SUITELEAF_GMAIL_CLIENT_ID` and `SUITELEAF_GMAIL_CLIENT_SECRET` on the
server (the existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are fallbacks).
Register this exact OAuth redirect URI in your Google Cloud project's web client:
`https://YOUR-SUITELEAF-SERVER/api/auth/suiteleaf/mail/google/callback`.
Enable the Gmail and People APIs. Enable Calendar and Tasks APIs when using the
optional Calendar/Tasks consent checkbox. Configure the OAuth consent screen and
allowed test users or production publishing for the requested scopes.

Consent requests Gmail mailbox access, basic Gmail settings, and contact reads;
Calendar reads and task management are optional. State is authenticated, encrypted,
time limited and single use; the code exchange uses PKCE. Refresh tokens stay
encrypted on the server. IMAP and SMTP use refreshed OAuth access tokens.

OAuth accounts fix their endpoints to Gmail's verified TLS hosts. Editing display
names and local signatures does not expose stored tokens. Use Reconnect Google to
replace a revoked grant or add Calendar/Tasks consent. Refresh accounts after
returning from the authorization browser.

Workspace forwarding, delegates and alias creation additionally require
`SUITELEAF_GMAIL_SERVICE_ACCOUNT`: a service-account JSON credential with
`client_email` and `private_key`, supplied through the server's secret environment.
A Workspace administrator must authorize domain-wide delegation for
`gmail.settings.sharing` and `gmail.settings.basic` using their full Google scope
URLs. SuiteLeaf signs the assertion for the mailbox verified by Google OAuth;
editing account settings cannot change that identity. Consumer Gmail accounts do
not support this administration mechanism. Google verification and organization
policies still apply to forwarding addresses, delegates and aliases.

The Node process needs outbound TCP access to the selected mail servers. This
requires a persistent SuiteLeaf server deployment; a hosting environment that
disallows raw TCP cannot provide the IMAP integration.

## Implemented behavior

| Area | Available |
| --- | --- |
| Accounts | Multiple accounts per signed-in user, test/save/edit/disconnect, signatures |
| Sync | Provider-backed folders; fresh IMAP reads; manual and one-minute idle refresh; server background polling and rule processing |
| Folders | List, create, rename, delete; provider special-use folders |
| Messages | Newest-first pages of 50, read/unread, stars, bulk selection, grouping by provider thread ID, paged conversation reader |
| Organization | Move, copy, archive, trash, spam, permanent deletion with confirmation |
| Search | Basic IMAP search fields and quoted terms; complete provider Gmail search syntax on Gmail; category, starred, important and All Mail views |
| Reading | MIME text/HTML, sandboxed sanitized HTML, inline raster images, opt-in remote HTTPS images, attachments, safe text/image/PDF previews, original EML download, print |
| Writing | Plain text or rich text, formatting/lists/links, To/Cc/Bcc, replies with references, forward including attachments, signature, templates, local/Google contacts autocomplete |
| Drafts | Explicit save and 15-second autosave while dirty; reopen/edit; replace prior saved copy after successful save/send |
| Sending | SMTP submission; identical MIME Sent copy where needed; Gmail avoids an extra Sent copy; partial delivery / Sent-copy failures are surfaced |
| Jobs | Scheduled sends, ten-second undo-send, cancel/reopen queued mail, snooze and unsnooze, persistent status receipts |
| Rules | Server-side inbox rules; Gmail provider filters; sender blocking through a filter/rule |
| Gmail | OAuth; apply/remove/edit labels; dated vacation responder; provider signatures; categories and importance views; Workspace delegates, forwarding and send-as aliases |
| Preferences | Keyboard shortcuts, compact/comfortable density, light/dark theme, conversation grouping, opt-in browser notifications |
| Google sidebar | Upcoming Calendar events, Tasks list/create/complete (requires optional service consent) |
| Sender identities | Select a verified Gmail send-as identity; unverified identities are rejected on the server |
| Offline | Opt-in, session-encrypted cache of viewed mail and fetched attachments; read-only fallback on network failure |
| Secure links | SuiteLeaf expiring passcode-protected delivery, recipient viewer, safe attachment preview, sender revocation |
| Writing assistant | Requested compose/reply/translation/summary suggestions through the existing SuiteLeaf assistant; review before insertion |

Attachments total at most 20 MB, with at most 30 files. Reading is bounded to
25 MB per raw message. Message commands accept at most 500 UIDs. The server
limits request bodies to 32 MB and concurrent mail commands to four per user.

## Storage and operations

Account settings and credentials are AES-256-GCM encrypted before entering
SuiteDB's `mail_account` table. Encryption is derived from the cluster's existing
`SUITELEAF_AUTH_SECRET`; all nodes must share that secret. Back up the secret with
the database. Changing it without re-encrypting mail records makes existing
accounts unreadable. Mail passwords and OAuth tokens are never stored in browser storage.
Rows are scoped to the authenticated SuiteLeaf user. Mail requests also pass
the Rust server's ban, expiration and idle-session checks.

Settings, queued messages, templates, contacts and rules are encrypted in
`mail_record`. Job ownership, state and due times are indexed plaintext metadata;
message contents and OAuth credentials are encrypted.

Offline storage is off by default. When enabled, viewed message data is encrypted
in IndexedDB using a key derived from the current SuiteLeaf session token. Other
sessions cannot decrypt it. The browser can reuse viewed data for up to 30 days
when a network request fails; HTTP authentication/authorization failures do not
fall back to cached content. Mutations are never silently queued offline. Turning
offline storage off clears this session's cache. Cached data from a signed-out
session remains encrypted and inaccessible without its token. An offline cached
session cannot learn about a remote revocation until it reconnects. This supports
offline reading in an already loaded browser app or the desktop app; it does not
install an offline web-app shell for a fresh browser navigation.

### Expiring secure links

This is a SuiteLeaf equivalent, not Gmail confidential-mode interoperability.
The sender chooses a passcode of at least eight characters and an expiry of up
to 30 days. The server requires an HTTPS public URL, stores the message encrypted,
and sends only a link through SMTP. The passcode must be shared separately.
The recipient needs no SuiteLeaf account. The viewer sanitizes HTML, blocks remote
images, offers safe attachment previews, and periodically rechecks access. Failed
passcode guesses are limited; ten failures temporarily lock the link for 30 minutes.
The sender can revoke access from Expiring sent messages. Disconnecting an account
also removes its active secure-message records.

This is not end-to-end encryption: the SuiteLeaf server holds the encryption key.
Revocation and expiry block future access, but cannot remove screenshots, copies,
or already viewed content. Replicated history/backups can retain encrypted earlier
records. Provider drafts saved before secure-link mode may already contain the
original text. Autosave and scheduled delivery are disabled in secure-link mode;
successful secure delivery attempts to remove the last autosaved provider draft.

### Mail writing assistant

Mail suggestions use the existing SuiteLeaf assistant configuration and organization
policy. The assistant must be enabled; remote content sharing must also be allowed
before a remote model receives email content. Requests contain at most 40,000
characters of the selected message/draft, treat that content as quoted data, and
declare no executable tools. Suggestions are shown for review and inserted only
on request. The mail helper never sends messages or executes suggested commands.
Generated text and translations still require the sender's review.

The server runs jobs every five seconds and inbox synchronization every minute.
Each job and background account belongs to one server identity, avoiding duplicate
SMTP submissions across replicated nodes. A self-hosted node uses its persistent
peer identity by default. `SUITELEAF_MAIL_WORKER_ID` can supply an explicitly stable
identity; use a **different value on each concurrently running server**. Externally
launched sidecars must set it themselves. Hosting with ephemeral node identities
requires a stable configured worker identity and a persistent worker process.
Do not run multiple sidecars with the same worker identity concurrently.

Jobs wait when their owning node is offline. Cancellation/editing must reach that
owning node. Delivery and cancellation are serialized there. A process interruption
during delivery produces an uncertain receipt, never an automatic resend. Banned
owners' jobs do not send mail. Undo-send cancels the queued send before delivery
starts and can reopen the message; it cannot recall a message already accepted by SMTP.

Snooze uses a provider folder named `SuiteLeaf Snoozed` and requires UIDPLUS to
track destination UIDs safely. Rules process newly arriving inbox UIDs after the
initial sync establishes a baseline; existing messages are not retroactively moved.
Use Mail preferences to inspect background sync health and manage rules/contacts.

This release updates the replicated database schema. Upgrade all cluster nodes
together; older nodes cannot apply newer mail operations. Cloud/Postgres operators
must run the normal cloud schema migration before starting the upgraded server.

IMAP UIDs are always paired with UIDVALIDITY and a selected-mailbox lock.
Stale commands fail and require a refresh. Remote changes are reconciled from
the provider rather than from a separate SuiteLeaf copy of mailbox state.
Disconnecting removes the SuiteLeaf account configuration, not provider mail.
Replicated database history and backups may retain encrypted historical settings.

SMTP acceptance and IMAP Sent filing are separate operations. If filing fails
after SMTP acceptance, the UI reports that the message was sent and must not be
resent. An interrupted SMTP transaction can have an uncertain outcome: check
the provider's Sent folder before retrying. There is no automatic send retry.

## Compatibility and remaining parity limits

This implements a broad Gmail-style experience, **not verified full Gmail parity**.
The Gmail API does not expose every native Gmail feature. SuiteLeaf supplies its
own secure-link and writing-assistant equivalents for confidential delivery,
composition/replies, translation and summary. They do not reproduce Google's
proprietary models, Gmail confidential-mode links, SMS verification, or account policy.

Remaining implementation gaps include Gmail-compatible confidential delivery,
import/export of full mailboxes,
customizable inbox section layouts, Gmail-compatible unsubscribe actions, and
cross-folder conversation reconciliation on generic IMAP providers. Gmail settings
include a native Google account-management link for administration of access.
Forwarding, aliases and delegation can require Workspace administrator authority.

Conversation groups are based on provider thread IDs within the current page;
the conversation reader matches message references within the selected folder.
Category classification and importance ranking use Gmail's provider data rather
than inventing these classifications on generic IMAP. Browser notifications require
permission and an open SuiteLeaf window; they do not provide closed-browser Web Push.
Rich HTML reading strips active content and CSS; complex marketing-email styling
can therefore differ from Gmail. Attachments with active formats must be downloaded.

Validation uses Vitest for behavior and Playwright for layout and real rich-text
typing. `npm run test:mail:stalwart` starts a disposable Stalwart 1.0.3 Docker
container and an isolated SuiteLeaf server, creates two local mailboxes, installs
a fixture certificate trusted only by that server process, and exercises the
authenticated API through real TLS IMAP/SMTP. Ports 18080, 19993, 1465 and 18787
must be free. Everything binds to loopback; only `suiteleaf.test` recipients are
used. The script removes its container and stops SuiteLeaf when finished, keeping
diagnostic logs under ignored `output/mail-stalwart-*` directories. Docker, Rust
and installed npm dependencies are required. It never disables TLS validation.
Gmail acceptance still requires an authorized Google account: a local provider
cannot establish Google's credentials, scopes, quotas or Workspace policies.

import type { CapabilityParityEntry } from "./types";

export const COMMUNICATIONS_PARITY_MATRIX: CapabilityParityEntry[] = [
  // Email
  {
    area: "email",
    feature: "Document review & share notifications",
    supportLevel: "integrated",
    provider: "SMTP / Microsoft Graph / Google Gmail API",
    notes: "Sends review invites and comment notifications with explicit permission grants.",
  },
  {
    area: "email",
    feature: "Native mail server hosting & spam filtering",
    supportLevel: "unsupported",
    provider: "None",
    notes: "SuiteLeaf relies on existing enterprise mail infrastructure; not a native MTA/IMAP server.",
  },
  {
    area: "email",
    feature: "Shared mailboxes and mailbox delegation",
    supportLevel: "unsupported",
    provider: "None",
    notes: "Mailbox delegation is managed within your external mail provider (Exchange / Google).",
  },

  // Calendar
  {
    area: "calendar",
    feature: "Document-linked calendar events & .ics export",
    supportLevel: "integrated",
    provider: "iCalendar (RFC 5545) / CalDAV / MS Graph / Google Calendar",
    notes: "Generates standard calendar invitations linking documents and meeting rooms.",
  },
  {
    area: "calendar",
    feature: "Physical conference room & resource booking",
    supportLevel: "unsupported",
    provider: "None",
    notes: "Resource booking requires external Exchange / Google Workspace calendar server.",
  },
  {
    area: "calendar",
    feature: "Complex recurrence with multi-timezone exceptions",
    supportLevel: "integrated",
    provider: "CalDAV / RFC 5545 standard RRULE",
    notes: "Standard daily/weekly/monthly recurrence supported; custom holiday exception rules deferred to provider.",
  },

  // Contacts
  {
    area: "contacts",
    feature: "Directory auto-complete for document sharing",
    supportLevel: "integrated",
    provider: "SCIM / SuiteDrive Directory / CardDAV",
    notes: "Respects organization visibility; private contacts never leaked to external users.",
  },
  {
    area: "contacts",
    feature: "vCard (RFC 6350) import and export",
    supportLevel: "integrated",
    provider: "CardDAV / vCard standards bridge",
    notes: "Standard format interoperability for personal and organization address books.",
  },

  // Chat
  {
    area: "chat",
    feature: "Document comments & thread sync to team channels",
    supportLevel: "integrated",
    provider: "Slack Webhooks / Matrix Client-Server API",
    notes: "Dispatches review notices and thread updates via signed webhooks.",
  },
  {
    area: "chat",
    feature: "Persistent native team chat channels & DM hosting",
    supportLevel: "unsupported",
    provider: "None",
    notes: "SuiteLeaf embeds live document collab chat; full team channels integrate with Slack/Matrix.",
  },

  // Meetings
  {
    area: "meetings",
    feature: "Meeting creation and join links on documents/calendars",
    supportLevel: "integrated",
    provider: "Jitsi / Google Meet / Microsoft Teams / Zoom",
    notes: "Embeds join URLs directly in calendar invites and document review headers.",
  },
  {
    area: "meetings",
    feature: "Native SFU/MCU video conferencing infrastructure",
    supportLevel: "unsupported",
    provider: "None",
    notes: "Conferencing media infrastructure is bridged via external WebRTC/Jitsi/Teams services.",
  },
];

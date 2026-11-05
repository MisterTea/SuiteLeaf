export type CommunicationsProviderType =
  | "email_smtp"
  | "google_workspace"
  | "microsoft_365"
  | "slack"
  | "matrix"
  | "caldav_carddav";

export type IntegrationSupportLevel = "native" | "integrated" | "unsupported";

export interface CapabilityParityEntry {
  area: "email" | "calendar" | "contacts" | "chat" | "meetings";
  feature: string;
  supportLevel: IntegrationSupportLevel;
  provider: string;
  notes: string;
}

export interface ReviewInvitationRequest {
  documentId: string;
  documentTitle: string;
  recipientEmail: string;
  intendedRole: "viewer" | "commenter" | "editor";
  message?: string;
  idempotencyKey: string;
}

export interface ReviewInvitationResult {
  invitationId: string;
  documentId: string;
  recipientEmail: string;
  grantedRole: "viewer" | "commenter" | "editor";
  sentAt: string;
  previewUrl: string;
  provider: CommunicationsProviderType;
  duplicatedSuppressed: boolean;
}

export interface CalendarEventRequest {
  title: string;
  description?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  linkedDocumentIds: string[];
  attendeeEmails: string[];
  generateMeetingUrl?: boolean;
  recurrenceRule?: string; // RFC 5545 RRULE
  idempotencyKey: string;
}

export interface CalendarEventResult {
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  meetingJoinUrl?: string;
  linkedDocumentIds: string[];
  iCalendarIcs: string; // RFC 5545 format
  createdAt: string;
  duplicatedSuppressed: boolean;
}

export interface DirectoryContact {
  id: string;
  name: string;
  email: string;
  visibility: "public" | "organization_only" | "private";
  orgId: string;
}

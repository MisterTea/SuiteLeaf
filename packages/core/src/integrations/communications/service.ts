import type {
  CalendarEventRequest,
  CalendarEventResult,
  CommunicationsProviderType,
  DirectoryContact,
  ReviewInvitationRequest,
  ReviewInvitationResult,
} from "./types";

export interface IntegrationCredentials {
  id: string;
  provider: CommunicationsProviderType;
  status: "active" | "revoked";
  accessToken?: string;
  smtpHost?: string;
}

export class CommunicationsIntegrationService {
  private credentials: Map<string, IntegrationCredentials> = new Map();
  private sentInvitations: Map<string, ReviewInvitationResult> = new Map(); // idempotencyKey -> result
  private calendarEvents: Map<string, CalendarEventResult> = new Map(); // idempotencyKey -> result
  private contacts: DirectoryContact[] = [];

  constructor(
    initialCredentials: IntegrationCredentials[] = [],
    initialContacts: DirectoryContact[] = [],
  ) {
    for (const cred of initialCredentials) {
      this.credentials.set(cred.id, cred);
    }
    this.contacts = [...initialContacts];
  }

  registerCredentials(cred: IntegrationCredentials) {
    this.credentials.set(cred.id, cred);
  }

  revokeCredentials(credentialId: string) {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`Credential ${credentialId} not found.`);
    cred.status = "revoked";
  }

  /**
   * Preview a review invitation before sending.
   */
  previewReviewInvitation(request: ReviewInvitationRequest): {
    documentId: string;
    recipientEmail: string;
    intendedRole: "viewer" | "commenter" | "editor";
    emailSubject: string;
    emailBody: string;
    accessNote: string;
  } {
    return {
      documentId: request.documentId,
      recipientEmail: request.recipientEmail,
      intendedRole: request.intendedRole,
      emailSubject: `Review Request: ${request.documentTitle}`,
      emailBody: `You have been invited to review '${request.documentTitle}'. Message: ${request.message ?? "No message provided."}`,
      accessNote: `Recipient will be granted strictly '${request.intendedRole}' access on document '${request.documentId}'. No permissions are broadened.`,
    };
  }

  /**
   * Send a document review invitation with idempotency and permission confinement.
   */
  sendReviewInvitation(
    credentialId: string,
    request: ReviewInvitationRequest,
    senderFn?: (to: string, subject: string, body: string) => Promise<boolean>,
  ): ReviewInvitationResult {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`Credential ${credentialId} not found.`);
    if (cred.status === "revoked") {
      throw new Error(`Credential ${credentialId} is revoked.`);
    }

    // Idempotency check: duplicate suppressed
    if (this.sentInvitations.has(request.idempotencyKey)) {
      const existing = this.sentInvitations.get(request.idempotencyKey)!;
      return {
        ...existing,
        duplicatedSuppressed: true,
      };
    }

    const invitationId = `inv_${Math.random().toString(36).slice(2, 9)}`;
    const previewUrl = `https://suiteleaf.internal/doc/${request.documentId}?role=${request.intendedRole}`;

    const result: ReviewInvitationResult = {
      invitationId,
      documentId: request.documentId,
      recipientEmail: request.recipientEmail,
      grantedRole: request.intendedRole, // Stays strictly within intendedRole
      sentAt: new Date().toISOString(),
      previewUrl,
      provider: cred.provider,
      duplicatedSuppressed: false,
    };

    if (senderFn) {
      senderFn(
        request.recipientEmail,
        `Review Request: ${request.documentTitle}`,
        request.message ?? "Review requested",
      );
    }

    this.sentInvitations.set(request.idempotencyKey, result);
    return result;
  }

  /**
   * Create a calendar event linked to documents with meeting link and RFC 5545 iCalendar payload.
   */
  createCalendarEvent(
    credentialId: string,
    request: CalendarEventRequest,
  ): CalendarEventResult {
    const cred = this.credentials.get(credentialId);
    if (!cred) throw new Error(`Credential ${credentialId} not found.`);
    if (cred.status === "revoked") {
      throw new Error(`Credential ${credentialId} is revoked.`);
    }

    // Idempotency check
    if (this.calendarEvents.has(request.idempotencyKey)) {
      const existing = this.calendarEvents.get(request.idempotencyKey)!;
      return {
        ...existing,
        duplicatedSuppressed: true,
      };
    }

    const eventId = `evt_${Math.random().toString(36).slice(2, 9)}`;
    const meetingJoinUrl = request.generateMeetingUrl
      ? `https://meet.suiteleaf.internal/room/${eventId}`
      : undefined;

    // Build RFC 5545 standard iCalendar format
    const icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SuiteLeaf//Calendar Integration//EN",
      "BEGIN:VEVENT",
      `UID:${eventId}@suiteleaf.internal`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(new Date(request.startTime))}`,
      `DTEND:${formatIcsDate(new Date(request.endTime))}`,
      `SUMMARY:${request.title}`,
      `DESCRIPTION:${request.description ?? "Document collaboration meeting"} \\nDocuments: ${request.linkedDocumentIds.join(", ")}`,
      meetingJoinUrl ? `URL:${meetingJoinUrl}` : "",
      request.recurrenceRule ? `RRULE:${request.recurrenceRule}` : "",
      ...request.attendeeEmails.map((email) => `ATTENDEE;CN=${email}:mailto:${email}`),
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean);

    const iCalendarIcs = icsLines.join("\r\n");

    const result: CalendarEventResult = {
      eventId,
      title: request.title,
      startTime: request.startTime,
      endTime: request.endTime,
      meetingJoinUrl,
      linkedDocumentIds: request.linkedDocumentIds,
      iCalendarIcs,
      createdAt: new Date().toISOString(),
      duplicatedSuppressed: false,
    };

    this.calendarEvents.set(request.idempotencyKey, result);
    return result;
  }

  /**
   * Search directory contacts respecting visibility boundaries.
   */
  searchContacts(query: string, requesterOrgId: string): DirectoryContact[] {
    const q = query.toLowerCase();
    return this.contacts.filter((c) => {
      if (c.visibility === "private" && c.orgId !== requesterOrgId) {
        return false;
      }
      if (c.visibility === "organization_only" && c.orgId !== requesterOrgId) {
        return false;
      }
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    });
  }

  /**
   * Explains unsupported communications features to users and administrators.
   */
  explainUnsupportedFeature(feature: "mailbox_delegation" | "resource_booking" | "custom_holiday_recurrence"): string {
    switch (feature) {
      case "mailbox_delegation":
        return "Shared mailboxes and delegate access are managed directly in your enterprise email provider (Exchange / Google Workspace). SuiteLeaf integrates through standard individual OAuth credentials.";
      case "resource_booking":
        return "Physical room booking and equipment reservations are handled by your external calendar provider (Exchange / Google Calendar). SuiteLeaf embeds virtual video conferencing rooms.";
      case "custom_holiday_recurrence":
        return "Custom calendar recurrence with arbitrary holiday exceptions is deferred to the connected calendar service. SuiteLeaf generates standard RFC 5545 RRULE patterns.";
    }
  }
}

function formatIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

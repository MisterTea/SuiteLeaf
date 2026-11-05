import { describe, expect, it, vi } from "vitest";
import {
  COMMUNICATIONS_PARITY_MATRIX,
  CommunicationsIntegrationService,
  type IntegrationCredentials,
} from "../packages/core/src/integrations/communications";

describe("WP-037: Communications Integrations", () => {
  const activeCred: IntegrationCredentials = {
    id: "cred_m365_1",
    provider: "microsoft_365",
    status: "active",
    accessToken: "valid_token",
  };

  it("completes preview and review invitation workflow with strict permission boundaries and idempotency", () => {
    const service = new CommunicationsIntegrationService([{ ...activeCred }]);

    const request = {
      documentId: "doc_budget_q4",
      documentTitle: "Q4 Marketing Budget",
      recipientEmail: "finance_reviewer@acme.com",
      intendedRole: "commenter" as const,
      message: "Please review the spend allocation in section 3.",
      idempotencyKey: "review_q4_budget_001",
    };

    // 1. Preview invitation before sending
    const preview = service.previewReviewInvitation(request);
    expect(preview.emailSubject).toContain("Review Request: Q4 Marketing Budget");
    expect(preview.intendedRole).toBe("commenter");
    expect(preview.accessNote).toContain("strictly 'commenter' access");

    // 2. Send invitation
    const mockSender = vi.fn();
    const result1 = service.sendReviewInvitation("cred_m365_1", request, mockSender);
    expect(result1.grantedRole).toBe("commenter"); // Never broadened!
    expect(result1.duplicatedSuppressed).toBe(false);
    expect(mockSender).toHaveBeenCalledTimes(1);

    // 3. Retry with same idempotency key suppresses duplicate email send
    const result2 = service.sendReviewInvitation("cred_m365_1", request, mockSender);
    expect(result2.duplicatedSuppressed).toBe(true);
    expect(result2.invitationId).toBe(result1.invitationId);
    expect(mockSender).toHaveBeenCalledTimes(1); // Still 1! Not duplicated!

    // 4. Revocation stops future actions
    service.revokeCredentials("cred_m365_1");
    expect(() =>
      service.sendReviewInvitation("cred_m365_1", {
        ...request,
        idempotencyKey: "review_new_attempt",
      }),
    ).toThrow("is revoked");
  });

  it("completes calendar-linked file and meeting-link workflow with standard iCalendar RFC 5545 output", () => {
    const service = new CommunicationsIntegrationService([{ ...activeCred }]);

    const eventReq = {
      title: "Design Review: Q4 Roadmap",
      description: "Review of engineering architecture and slide deck",
      startTime: "2026-11-15T10:00:00Z",
      endTime: "2026-11-15T11:00:00Z",
      linkedDocumentIds: ["doc_arch_spec", "deck_roadmap"],
      attendeeEmails: ["alice@acme.com", "bob@acme.com"],
      generateMeetingUrl: true,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      idempotencyKey: "cal_design_rev_weekly",
    };

    const eventResult = service.createCalendarEvent("cred_m365_1", eventReq);
    expect(eventResult.meetingJoinUrl).toContain("https://meet.suiteleaf.internal/room/");
    expect(eventResult.linkedDocumentIds).toEqual(["doc_arch_spec", "deck_roadmap"]);
    expect(eventResult.duplicatedSuppressed).toBe(false);

    // Verify RFC 5545 format
    expect(eventResult.iCalendarIcs).toContain("BEGIN:VCALENDAR");
    expect(eventResult.iCalendarIcs).toContain("BEGIN:VEVENT");
    expect(eventResult.iCalendarIcs).toContain("SUMMARY:Design Review: Q4 Roadmap");
    expect(eventResult.iCalendarIcs).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(eventResult.iCalendarIcs).toContain("ATTENDEE;CN=alice@acme.com:mailto:alice@acme.com");
    expect(eventResult.iCalendarIcs).toContain("END:VEVENT");

    // Idempotent retry suppresses duplicate calendar event creation
    const retryEvent = service.createCalendarEvent("cred_m365_1", eventReq);
    expect(retryEvent.duplicatedSuppressed).toBe(true);
    expect(retryEvent.eventId).toBe(eventResult.eventId);
  });

  it("enforces directory contact visibility boundaries", () => {
    const service = new CommunicationsIntegrationService([], [
      {
        id: "c1",
        name: "Carol Danvers",
        email: "carol@org1.com",
        visibility: "organization_only",
        orgId: "org_1",
      },
      {
        id: "c2",
        name: "David Smith",
        email: "david@org2.com",
        visibility: "organization_only",
        orgId: "org_2",
      },
      {
        id: "c3",
        name: "Public Partner",
        email: "partner@public.com",
        visibility: "public",
        orgId: "org_2",
      },
      {
        id: "c4",
        name: "Private Executive",
        email: "exec@org2.com",
        visibility: "private",
        orgId: "org_2",
      },
    ]);

    // User in org_1 searches for contacts
    const org1Results = service.searchContacts("org", "org_1");
    // Sees carol@org1.com and public partner, but NOT david@org2.com or private executive!
    expect(org1Results.map((c) => c.name)).toContain("Carol Danvers");
    expect(org1Results.some((c) => c.email === "david@org2.com")).toBe(false);
    expect(org1Results.some((c) => c.email === "exec@org2.com")).toBe(false);
  });

  it("clearly labels integrated, native, and unsupported capabilities in the parity matrix", () => {
    expect(COMMUNICATIONS_PARITY_MATRIX.length).toBeGreaterThanOrEqual(10);

    const integrated = COMMUNICATIONS_PARITY_MATRIX.filter((c) => c.supportLevel === "integrated");
    const unsupported = COMMUNICATIONS_PARITY_MATRIX.filter((c) => c.supportLevel === "unsupported");

    expect(integrated.length).toBeGreaterThan(0);
    expect(unsupported.length).toBeGreaterThan(0);

    // Unsupported features are clearly explained
    const service = new CommunicationsIntegrationService();
    const explanationDelegation = service.explainUnsupportedFeature("mailbox_delegation");
    expect(explanationDelegation).toContain("Shared mailboxes and delegate access are managed directly");

    const explanationBooking = service.explainUnsupportedFeature("resource_booking");
    expect(explanationBooking).toContain("Physical room booking and equipment reservations");
  });
});

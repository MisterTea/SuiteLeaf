import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { WebhookDelivery, WebhookEvent, WebhookSubscription } from "./types";

export function signWebhookPayload(payload: string, secret: string, timestamp: number): string {
  const message = `${timestamp}.${payload}`;
  const keyBytes = new TextEncoder().encode(secret);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = hmac(sha256, keyBytes, messageBytes);
  return `t=${timestamp},v1=${bytesToHex(signatureBytes)}`;
}

export function verifyWebhookSignature(
  payload: string,
  headerSignature: string,
  secret: string,
  options: { toleranceSeconds?: number; currentTime?: number; previousSecret?: string } = {},
): boolean {
  const tolerance = (options.toleranceSeconds ?? 300) * 1000;
  const now = options.currentTime ?? Date.now();

  const parts = headerSignature.split(",");
  const timePart = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigPart = parts.find((p) => p.startsWith("v1="))?.slice(3);

  if (!timePart || !sigPart) return false;
  const timestamp = parseInt(timePart, 10);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > tolerance) {
    return false; // Replay attack or expired
  }

  const expectedCurrent = signWebhookPayload(payload, secret, timestamp);
  const expectedCurrentSig = expectedCurrent.split("v1=")[1];
  if (sigPart === expectedCurrentSig) return true;

  // Secret rotation support: check previous secret if available
  if (options.previousSecret) {
    const expectedPrevious = signWebhookPayload(payload, options.previousSecret, timestamp);
    const expectedPreviousSig = expectedPrevious.split("v1=")[1];
    if (sigPart === expectedPreviousSig) return true;
  }

  return false;
}

export class WebhookService {
  private subscriptions: Map<string, WebhookSubscription> = new Map();
  private deliveries: WebhookDelivery[] = [];
  private deadLetterQueue: WebhookDelivery[] = [];

  registerSubscription(sub: Omit<WebhookSubscription, "id" | "createdAt">): WebhookSubscription {
    const id = `wh_${Math.random().toString(36).slice(2, 9)}`;
    const full: WebhookSubscription = {
      ...sub,
      id,
      createdAt: new Date().toISOString(),
    };
    this.subscriptions.set(id, full);
    return full;
  }

  rotateSecret(subscriptionId: string, newSecret: string): WebhookSubscription {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new Error(`Webhook ${subscriptionId} not found.`);
    sub.previousSecret = sub.signingSecret;
    sub.signingSecret = newSecret;
    return sub;
  }

  async dispatchEvent(
    event: WebhookEvent,
    payload: Record<string, unknown>,
    senderFn?: (url: string, headers: Record<string, string>, body: string) => Promise<{ ok: boolean; status: number }>,
  ): Promise<WebhookDelivery[]> {
    const activeSubs = Array.from(this.subscriptions.values()).filter(
      (s) => s.active && s.events.includes(event),
    );

    const now = Date.now();
    const payloadJson = JSON.stringify(payload);
    const results: WebhookDelivery[] = [];

    for (const sub of activeSubs) {
      const signature = signWebhookPayload(payloadJson, sub.signingSecret, now);
      const delivery: WebhookDelivery = {
        id: `del_${Math.random().toString(36).slice(2, 9)}`,
        webhookId: sub.id,
        event,
        payload,
        signature,
        timestamp: now,
        attempts: 1,
        status: "pending",
      };

      if (senderFn) {
        try {
          const res = await senderFn(
            sub.url,
            {
              "Content-Type": "application/json",
              "SuiteLeaf-Signature": signature,
            },
            payloadJson,
          );
          if (res.ok) {
            delivery.status = "delivered";
          } else {
            delivery.status = "failed";
            delivery.lastError = `HTTP status ${res.status}`;
          }
        } catch (err: unknown) {
          delivery.status = "failed";
          delivery.lastError = err instanceof Error ? err.message : String(err);
        }
      } else {
        delivery.status = "delivered";
      }

      this.deliveries.push(delivery);
      results.push(delivery);
    }

    return results;
  }

  async retryDelivery(
    deliveryId: string,
    senderFn: (url: string, headers: Record<string, string>, body: string) => Promise<{ ok: boolean; status: number }>,
    maxRetries = 3,
  ): Promise<WebhookDelivery> {
    const delivery = this.deliveries.find((d) => d.id === deliveryId);
    if (!delivery) throw new Error(`Delivery ${deliveryId} not found.`);
    const sub = this.subscriptions.get(delivery.webhookId);
    if (!sub) throw new Error(`Subscription not found.`);

    delivery.attempts++;
    const payloadJson = JSON.stringify(delivery.payload);
    try {
      const res = await senderFn(
        sub.url,
        {
          "Content-Type": "application/json",
          "SuiteLeaf-Signature": delivery.signature,
        },
        payloadJson,
      );
      if (res.ok) {
        delivery.status = "delivered";
        delivery.lastError = undefined;
      } else {
        delivery.lastError = `HTTP status ${res.status}`;
        if (delivery.attempts >= maxRetries) {
          delivery.status = "dead_letter";
          this.deadLetterQueue.push(delivery);
        } else {
          delivery.status = "failed";
        }
      }
    } catch (err: unknown) {
      delivery.lastError = err instanceof Error ? err.message : String(err);
      if (delivery.attempts >= maxRetries) {
        delivery.status = "dead_letter";
        this.deadLetterQueue.push(delivery);
      } else {
        delivery.status = "failed";
      }
    }

    return delivery;
  }

  getDeadLetterQueue(): WebhookDelivery[] {
    return [...this.deadLetterQueue];
  }
}

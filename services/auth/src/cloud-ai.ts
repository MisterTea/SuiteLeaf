import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { streamText } from "ai";
import { createGateway, gateway } from "@ai-sdk/gateway";
import { acceptsBridgeToken } from "./cloud-blobs";

export function completionFrame(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ text, index: 0, finish_reason: null }] })}\n\n`;
}

/** Keep the existing native completion wire format while Gateway uses chat. */
export async function cloudAiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
): Promise<void> {
  if (!acceptsBridgeToken(req.headers.authorization, token)) {
    res.writeHead(401).end();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4_000_000) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(Buffer.from(chunk));
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (
    !input ||
    typeof input !== "object" ||
    !("prompt" in input) ||
    typeof input.prompt !== "string"
  ) {
    res.writeHead(400).end();
    return;
  }
  const controller = new AbortController();
  const cancel = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", cancel);
  // Container requests carry a fresh platform OIDC token. Keep it scoped to
  // this call rather than mutating process.env across concurrent requests.
  const oidc = req.headers["x-vercel-oidc-token"];
  const provider =
    typeof oidc === "string" && oidc
      ? createGateway({
          apiKey: oidc,
          headers: { "ai-gateway-auth-method": "oidc" },
        })
      : gateway;
  const result = streamText({
    model: provider(
      process.env.SUITELEAF_AI_GATEWAY_MODEL ?? "openai/gpt-5-mini",
    ),
    instructions:
      "Continue the following rendered assistant conversation. Follow its requested response and tool-call syntax exactly. Output only the assistant continuation, without repeating the prompt.",
    prompt: input.prompt,
    maxOutputTokens:
      "max_tokens" in input &&
      typeof input.max_tokens === "number" &&
      Number.isSafeInteger(input.max_tokens)
        ? Math.max(1, Math.min(8192, input.max_tokens))
        : 8192,
    abortSignal: controller.signal,
  });
  try {
    for await (const part of result.fullStream) {
      if (part.type === "error")
        throw new Error(
          "The assistant provider could not complete this request.",
        );
      if (part.type === "text-delta") {
        if (!res.headersSent)
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
          });
        if (!res.write(completionFrame(part.text)))
          await once(res, "drain", { signal: controller.signal });
      }
    }
    if (!res.headersSent)
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
      });
    res.end("data: [DONE]\n\n");
  } catch {
    if (!res.destroyed) {
      const error = {
        error: {
          message:
            "The hosted assistant is unavailable. Ask an administrator to check AI Gateway.",
        },
      };
      if (!res.headersSent)
        res
          .writeHead(503, {
            "content-type": "application/json",
            "cache-control": "no-store",
          })
          .end(JSON.stringify({ error: error.error.message }));
      else res.end(`data: ${JSON.stringify(error)}\n\n`);
    }
  } finally {
    controller.abort();
    res.off("close", cancel);
  }
}

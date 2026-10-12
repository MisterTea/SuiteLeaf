import { createServer, type ServerResponse } from "node:http";
import { betterAuth } from "better-auth";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { suitedbAdapter } from "./adapter";
import { authOptions, envFromProcess, providers } from "./options";

const env = envFromProcess();
const internalUrl = process.env.SUITELEAF_INTERNAL_URL;
const internalToken = process.env.SUITELEAF_INTERNAL_TOKEN;
if (!internalUrl || !internalToken)
  throw new Error(
    "SUITELEAF_INTERNAL_URL and SUITELEAF_INTERNAL_TOKEN are set by suiteleaf-node.",
  );

// The node holds our stdin open; when it exits, so do we.
if (process.env.SUITELEAF_EXIT_WITH_STDIN === "1") {
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.resume();
}

const auth = betterAuth(
  authOptions(env, suitedbAdapter({ url: internalUrl, token: internalToken })),
);
const handler = toNodeHandler(auth);
const enabled = providers(env);

/** Hand-off targets must be trusted origins, such as `suiteleaf://app` or a
 * web build served from another host. */
function trustedRedirect(value: string | null): string | null {
  if (!value) return null;
  try {
    const target = new URL(value);
    const origin =
      target.origin === "null"
        ? `${target.protocol}//${target.host}`
        : target.origin;
    return env.trustedOrigins.includes(origin) ? value : null;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(body);
}

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", env.baseURL);
  try {
    if (url.pathname === "/health") return send(res, 200, "text/plain", "ok");
    if (url.pathname === "/api/auth/suiteleaf/providers")
      return send(
        res,
        200,
        "application/json",
        JSON.stringify({
          emailAndPassword: true,
          username: true,
          providers: enabled,
        }),
      );
    if (url.pathname === "/api/auth/suiteleaf/start") {
      // Starts social sign-in on the node's own origin so the OAuth state
      // cookie lands here, then hands the session back via a one-time token.
      const provider = url.searchParams.get("provider") ?? "";
      const redirect = trustedRedirect(url.searchParams.get("redirect"));
      if (!enabled.includes(provider) || !redirect)
        return send(
          res,
          400,
          "text/plain",
          "Unknown provider or untrusted redirect.",
        );
      const complete = `${env.baseURL}/api/auth/suiteleaf/complete?redirect=${encodeURIComponent(redirect)}`;
      // genericOAuth providers such as Nextcloud are first-class social
      // providers, so every provider starts at the same endpoint.
      const body = { provider, callbackURL: complete };
      return send(
        res,
        200,
        "text/html; charset=utf-8",
        `<!doctype html><meta charset="utf-8"><title>Signing in…</title><p>Signing in…</p><script>
fetch(${json(`${env.baseURL}/api/auth/sign-in/social`)},{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:${json(JSON.stringify(body))}})
.then(r=>r.json()).then(d=>{if(d.url)location.href=d.url;else document.body.textContent=d.message||"Sign-in failed."})
.catch(e=>{document.body.textContent=String(e)});
</script>`,
      );
    }
    if (url.pathname === "/api/auth/suiteleaf/complete") {
      const redirect = trustedRedirect(url.searchParams.get("redirect"));
      if (!redirect) return send(res, 400, "text/plain", "Untrusted redirect.");
      const headers = fromNodeHeaders(req.headers);
      const { token } = await auth.api.generateOneTimeToken({ headers });
      const target = new URL(redirect);
      target.hash = `/auth-complete?token=${encodeURIComponent(token)}`;
      res.writeHead(302, {
        location: target.toString(),
        "cache-control": "no-store",
      });
      return res.end();
    }
    return handler(req, res);
  } catch (error) {
    console.error(error);
    return send(res, 500, "text/plain", "Authentication service error.");
  }
}).listen(
  Number(process.env.SUITELEAF_AUTH_PORT ?? 0),
  "127.0.0.1",
  function (this: import("node:net").Server) {
    const address = this.address();
    const port = typeof address === "object" && address ? address.port : 0;
    console.log(`SUITELEAF_AUTH_READY ${port}`);
  },
);

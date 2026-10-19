import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import {
  admin,
  bearer,
  genericOAuth,
  jwt,
  oneTimeToken,
  organization,
  username,
} from "better-auth/plugins";
import { firstAccountIsAdmin, isAdminRole, removesLastAdmin } from "./guards";

/** JWTs are verified by every node, so issuer and audience are cluster-wide
 * constants rather than a node's own URL. */
export const JWT_ISSUER = "suiteleaf";
export const JWT_AUDIENCE = "suiteleaf";

export interface AuthEnv {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
  nextcloud?: { url: string; clientId: string; clientSecret: string };
}

export function envFromProcess(env = process.env): AuthEnv {
  const pair = (id?: string, secret?: string) =>
    id && secret ? { clientId: id, clientSecret: secret } : undefined;
  const nextcloud = pair(env.NEXTCLOUD_CLIENT_ID, env.NEXTCLOUD_CLIENT_SECRET);
  const secret = env.SUITELEAF_AUTH_SECRET ?? env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "SUITELEAF_AUTH_SECRET must be at least 32 characters and identical on every node.",
    );
  const baseURL = env.SUITELEAF_PUBLIC_URL ?? "http://127.0.0.1:8787";
  return {
    baseURL,
    secret,
    trustedOrigins: [
      baseURL,
      ...(env.SUITELEAF_TRUSTED_ORIGINS ?? "suiteleaf://app")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ],
    google: pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    github: pair(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    nextcloud:
      nextcloud && env.NEXTCLOUD_URL
        ? { ...nextcloud, url: env.NEXTCLOUD_URL.replace(/\/+$/, "") }
        : undefined,
  };
}

export function nextcloudProvider(config: NonNullable<AuthEnv["nextcloud"]>) {
  return {
    providerId: "nextcloud",
    name: "Nextcloud",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorizationUrl: `${config.url}/index.php/apps/oauth2/authorize`,
    tokenUrl: `${config.url}/index.php/apps/oauth2/api/v1/token`,
    scopes: [],
    async getUserInfo(tokens: { accessToken?: string }) {
      const response = await fetch(
        `${config.url}/ocs/v2.php/cloud/user?format=json`,
        {
          headers: {
            authorization: `Bearer ${tokens.accessToken}`,
            "ocs-apirequest": "true",
            accept: "application/json",
          },
        },
      );
      if (!response.ok) return null;
      const data = (
        (await response.json()) as {
          ocs?: {
            data?: { id: string; email?: string | null; displayname?: string };
          };
        }
      ).ocs?.data;
      if (!data?.id) return null;
      // Nextcloud users set their profile email without verification, so it
      // must never link to an existing account.
      return {
        id: data.id,
        email: data.email || `${data.id}@nextcloud.invalid`,
        name: data.displayname || data.id,
        emailVerified: false,
      };
    },
  };
}

/** Plugins determine the replicated tables, so they do not depend on which
 * providers a node has configured. */
export function plugins(env?: AuthEnv) {
  return [
    username(),
    admin(),
    organization(),
    jwt({
      jwt: {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expirationTime: "15m",
      },
    }),
    bearer(),
    oneTimeToken({ expiresIn: 3 }),
    genericOAuth({
      config: env?.nextcloud ? [nextcloudProvider(env.nextcloud)] : [],
    }),
  ];
}

export function providers(env: AuthEnv) {
  return [
    ...(env.google ? ["google"] : []),
    ...(env.github ? ["github"] : []),
    ...(env.nextcloud ? ["nextcloud"] : []),
  ];
}

export function authOptions(
  env: AuthEnv,
  database: BetterAuthOptions["database"],
) {
  return {
    appName: "SuiteLeaf",
    baseURL: env.baseURL,
    basePath: "/api/auth",
    secret: env.secret,
    database,
    trustedOrigins: env.trustedOrigins,
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders: {
      ...(env.google ? { google: env.google } : {}),
      ...(env.github ? { github: env.github } : {}),
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "github"],
      },
    },
    rateLimit: { enabled: true, storage: "memory" },
    telemetry: { enabled: false },
    plugins: plugins(env),
    databaseHooks: {
      user: {
        create: {
          async before(user, context) {
            if (!context) return;
            const existing = Number(
              await context.context.adapter.count({ model: "user" }),
            );
            if (firstAccountIsAdmin(existing))
              return { data: { ...user, role: "admin" } };
          },
          async after(user, context) {
            await writeAudit(context, {
              actorId: sessionActor(context) ?? user.id,
              action: "user.create",
              targetType: "user",
              targetId: user.id,
              name: user.email ?? user.name ?? "",
            });
          },
        },
        update: {
          async before(data, context) {
            const userId = bodyUserId(context);
            if (!context || !userId) return;
            const current = await context.context.adapter.findOne<{
              id: string;
              role?: string | null;
              banned?: boolean | number | null;
            }>({
              model: "user",
              where: [{ field: "id", value: userId }],
            });
            if (!current) return;
            const others = await otherActiveAdmins(
              context.context.adapter,
              userId,
            );
            if (
              removesLastAdmin({
                targetIsActiveAdmin:
                  isAdminRole(current.role) && !current.banned,
                otherActiveAdmins: others,
                nextRole: "role" in data ? data.role : undefined,
                banned: "banned" in data ? data.banned : undefined,
              })
            ) {
              throw new APIError("BAD_REQUEST", {
                message: "The server needs at least one admin.",
              });
            }
          },
        },
        delete: {
          async before(user, context) {
            if (!context || !isAdminRole(user.role) || user.banned) return;
            const others = await otherActiveAdmins(
              context.context.adapter,
              user.id,
            );
            if (others === 0) {
              throw new APIError("BAD_REQUEST", {
                message: "The server needs at least one admin.",
              });
            }
          },
        },
      },
      session: {
        create: {
          async after(session, context) {
            const where = [session.ipAddress, session.userAgent]
              .filter(Boolean)
              .join(" · ");
            await writeAudit(context, {
              actorId: session.userId,
              action: "sign-in",
              targetType: "session",
              targetId: session.id,
              name: where,
            });
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

function sessionActor(context: {
  context?: { session?: { user?: { id?: string } } | null };
} | null): string | undefined {
  return context?.context?.session?.user?.id;
}

function bodyUserId(context: { body?: unknown } | null): string | undefined {
  const body = context?.body as { userId?: unknown } | undefined;
  return typeof body?.userId === "string" ? body.userId : undefined;
}

async function otherActiveAdmins(
  adapter: {
    findMany: (input: { model: string }) => Promise<unknown[]>;
  },
  exceptId: string,
): Promise<number> {
  const rows = (await adapter.findMany({ model: "user" })) as {
    id: string;
    role?: string | null;
    banned?: boolean | number | null;
  }[];
  return rows.filter(
    (row) => row.id !== exceptId && isAdminRole(row.role) && !row.banned,
  ).length;
}

async function writeAudit(
  _context: unknown,
  event: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    name: string;
  },
) {
  const url = process.env.SUITELEAF_INTERNAL_URL;
  const token = process.env.SUITELEAF_INTERNAL_TOKEN;
  if (!url || !token || !event.actorId || !event.targetId) return;
  try {
    const response = await fetch(`${url}/internal/db`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-suiteleaf-internal": token,
      },
      body: JSON.stringify({
        op: "create",
        model: "audit_event",
        data: {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          actorId: event.actorId,
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId,
          name: event.name,
        },
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error("SuiteLeaf audit:", response.status, body);
    }
  } catch (error) {
    console.error("SuiteLeaf audit:", error);
  }
}

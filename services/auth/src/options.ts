import type { BetterAuthOptions } from "better-auth";
import {
  admin,
  bearer,
  genericOAuth,
  jwt,
  oneTimeToken,
  organization,
  username,
} from "better-auth/plugins";

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
      return {
        id: data.id,
        email: data.email || `${data.id}@nextcloud.invalid`,
        name: data.displayname || data.id,
        emailVerified: !!data.email,
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
        trustedProviders: ["google", "github", "nextcloud"],
      },
    },
    rateLimit: { enabled: true, storage: "memory" },
    telemetry: { enabled: false },
    plugins: plugins(env),
  } satisfies BetterAuthOptions;
}

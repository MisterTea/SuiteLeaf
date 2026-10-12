import { afterEach, expect, it, vi } from "vitest";
import { authOptions, nextcloudProvider } from "../src/options";

const nextcloud = {
  url: "https://cloud.example.com",
  clientId: "id",
  clientSecret: "secret",
};

afterEach(() => vi.unstubAllGlobals());

it("does not let a Nextcloud profile email sign in to an existing account", async () => {
  const options = authOptions(
    {
      baseURL: "http://localhost",
      secret: "x".repeat(32),
      trustedOrigins: [],
      nextcloud,
    },
    undefined,
  );
  expect(options.account.accountLinking.trustedProviders).not.toContain(
    "nextcloud",
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ocs: {
          data: {
            id: "mallory",
            email: "admin@example.com",
            displayname: "Mallory",
          },
        },
      }),
    ),
  );
  const user = await nextcloudProvider(nextcloud).getUserInfo({
    accessToken: "token",
  });
  expect(user).toMatchObject({
    id: "mallory",
    email: "admin@example.com",
    emailVerified: false,
  });
});

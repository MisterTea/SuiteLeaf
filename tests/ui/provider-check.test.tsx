// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ProviderCheck } from "../../apps/web/src/admin/provider-check";

afterEach(cleanup);

it("checks a provider draft and does not show the client secret", async () => {
  render(<ProviderCheck />);
  await userEvent.type(screen.getByLabelText("Provider issuer"), "secret-value");
  await userEvent.type(screen.getByLabelText("Provider client secret"), "secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Check provider" }));
  expect(screen.getByRole("status").textContent).toBe("The issuer must be an https address.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
  await userEvent.clear(screen.getByLabelText("Provider issuer"));
  await userEvent.type(screen.getByLabelText("Provider issuer"), "https://idp.example");
  await userEvent.type(screen.getByLabelText("Provider audience"), "suiteleaf");
  await userEvent.click(screen.getByRole("button", { name: "Check provider" }));
  expect(screen.getByRole("status").textContent).toBe(
    "The provider settings can be saved. The client secret is not shown.",
  );
  expect(screen.getByRole("region", { name: "Identity provider" }).textContent).not.toContain(
    "secret-value",
  );
});

it("checks OpenID Connect metadata and does not repeat a credential", async () => {
  render(<ProviderCheck />);
  await userEvent.type(screen.getByLabelText("Provider issuer"), "https://idp.example/realms/garden");
  await userEvent.type(screen.getByLabelText("Provider audience"), "suiteleaf");
  await userEvent.click(screen.getByLabelText("Provider metadata"));
  await userEvent.paste(
    JSON.stringify({
      issuer: "https://idp.example/realms/garden",
      authorization_endpoint: "https://idp.example/auth",
      token_endpoint: "https://idp.example/token",
      jwks_uri: "http://secret-value.example/jwks",
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Check provider" }));
  expect(screen.getByRole("status").textContent).toBe("The provider metadata must use https.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
});

it("checks SAML metadata and does not repeat a credential", async () => {
  render(<ProviderCheck />);
  await userEvent.selectOptions(screen.getByLabelText("Provider protocol"), "saml");
  await userEvent.type(screen.getByLabelText("Provider issuer"), "https://idp.example/realms/garden");
  await userEvent.type(screen.getByLabelText("Provider audience"), "suiteleaf");
  await userEvent.click(screen.getByLabelText("Provider metadata"));
  await userEvent.paste(
    `<EntityDescriptor entityID="https://idp.example/realms/garden"><SingleSignOnService Location="http://secret-value.example/saml" /></EntityDescriptor>`,
  );
  await userEvent.click(screen.getByRole("button", { name: "Check provider" }));
  expect(screen.getByRole("status").textContent).toBe("The provider metadata must use https.");
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
});

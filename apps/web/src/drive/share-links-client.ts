import { api, getSession } from "../node-client";

export type PublicLinkState = { allowed: boolean; token: string | null };
export function shareUrl(route: "shared" | "public", id: string): string {
  const url = new URL(getSession()?.url || window.location.href);
  url.search = "";
  url.hash = `/${route}/${encodeURIComponent(id)}`;
  return url.href;
}
export async function publicLink(
  itemId: string,
  method = "GET",
): Promise<PublicLinkState> {
  const response = await api(
    `/api/drive/items/${encodeURIComponent(itemId)}/public-link`,
    { method },
  );
  if (method === "DELETE") return { allowed: true, token: null };
  return response.json() as Promise<PublicLinkState>;
}
export async function publicSharingPolicy(
  allowed?: boolean,
): Promise<{ allowed: boolean }> {
  const response = await api(
    "/api/admin/public-sharing",
    allowed === undefined
      ? {}
      : {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowed }),
        },
  );
  return response.json() as Promise<{ allowed: boolean }>;
}

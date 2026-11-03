import { importBibtex, type BibIssue } from "./bibliography";
import type { CitationSource } from "./citations";

export type ReferenceResponse = { status: number; body: string };

/**
 * Read BibTeX from a reference manager the caller allows.
 * Nothing is fetched unless the address is https, the computer is online,
 * and the person allowed the connection. A secret in the address or in an
 * error body is not returned.
 */
export async function fetchReferenceLibrary(
  address: string,
  existing: readonly CitationSource[],
  options: {
    allowed: boolean;
    online: boolean;
    fetchLibrary: (address: string) => Promise<ReferenceResponse>;
  },
): Promise<{ sources: CitationSource[]; issues: BibIssue[]; fetched: boolean }> {
  const kept = existing.map((source) => ({ ...source }));
  const refuse = (message: string) => ({ sources: kept, issues: [{ key: "", message }], fetched: false });
  if (!options.allowed) return refuse("The reference manager is not allowed.");
  if (!options.online) return refuse("The reference manager is offline. The saved sources were kept.");
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return refuse("The reference manager address is not a web address.");
  }
  if (parsed.protocol !== "https:") return refuse("The reference manager address is not https.");
  if (parsed.username || parsed.password) return refuse("The reference manager address includes a secret.");
  let response: ReferenceResponse;
  try {
    response = await options.fetchLibrary(parsed.toString());
  } catch {
    return refuse("The reference manager did not answer.");
  }
  if (response.status !== 200) return refuse("The reference manager did not answer.");
  const imported = importBibtex(response.body, kept);
  return { sources: imported.sources, issues: imported.issues, fetched: true };
}

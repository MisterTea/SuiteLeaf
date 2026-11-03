const SECRET = /password|secret|token|authorization|api[-_]?key|credential/i;

/** Why a source address cannot be fetched. The address is not repeated. */
export function sourceUrlProblem(url: string): string | null {
  if (!url.startsWith("https://")) return "The source address is not https.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "The source address is not https.";
  }
  if (parsed.username || parsed.password) return "The source address cannot include a credential.";
  for (const key of parsed.searchParams.keys()) {
    if (SECRET.test(key)) return "The source address cannot include a credential.";
  }
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return "The source address cannot include a credential.";
  }
  if (SECRET.test(path) || SECRET.test(parsed.hash)) return "The source address cannot include a credential.";
  return null;
}

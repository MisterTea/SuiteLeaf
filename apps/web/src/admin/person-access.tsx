import { useState } from "react";

export interface PersonFileAccess {
  itemId: string;
  itemName: string;
  role: string;
  source: string;
  inheritedFrom?: string | null;
  groupName?: string | null;
}

const ROLES = new Set(["owner", "editor", "commenter", "viewer", "responder"]);

function clean(value: string | null | undefined, fallback: string): string {
  const text = value?.trim() ?? "";
  if (!text || /secret|password|token|api[_-]?key/i.test(text)) return fallback;
  return text;
}

/** One file this person can open. Other group members are not named. */
export function personAccessLine(file: PersonFileAccess): string {
  const name = clean(file.itemName, "this item");
  const role = ROLES.has(file.role) ? file.role : "another role";
  const parts = [`${name} as ${role}`];
  if (file.source === "group") parts.push(`through ${clean(file.groupName, "a group")}`);
  if (file.source === "org") parts.push("through an organization");
  if (file.inheritedFrom) parts.push(`from ${clean(file.inheritedFrom, "a folder")}`);
  return `${parts.join(" ")}.`;
}

export function PersonAccess({
  onLoad,
}: {
  onLoad: () => Promise<{ files: PersonFileAccess[] }>;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState("");

  return (
    <section>
      <button
        type="button"
        onClick={() => {
          setError("");
          void onLoad()
            .then((result) => setLines(result.files.map(personAccessLine)))
            .catch((reason: unknown) => {
              setLines([]);
              const message = reason instanceof Error ? reason.message : "";
              setError(message === "Name the person." ? message : "Those files could not be read.");
            });
        }}
      >
        Files this person can open
      </button>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {error ? <p>{error}</p> : null}
    </section>
  );
}

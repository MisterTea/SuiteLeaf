import { checkDocument, nodeAtPath, type JsonNode } from "@suiteleaf/core";

/** Notes from the document checker. Automatic notes were decided by the program. */
export function AccessNotes({
  doc,
  onSelect,
}: {
  doc: JsonNode;
  onSelect?: (path: number[]) => void;
}) {
  const findings = checkDocument(doc);
  return (
    <section className="access-notes" aria-label="Accessibility notes">
      <h2>Accessibility notes</h2>
      <p>
        Automatic notes were decided by the program. The others need a person. This is not a
        conformance claim.
      </p>
      {findings.length === 0 ? (
        <p>No notes for this document.</p>
      ) : (
        <ul>
          {findings.map((finding, index) => {
            const target = nodeAtPath(doc, finding.path);
            return (
              <li key={`${finding.rule}-${finding.path.join(".")}-${index}`}>
                <button type="button" onClick={() => onSelect?.(finding.path)}>
                  <strong>{finding.automatic ? "Automatic" : "Needs a person"}</strong>
                  <span>{finding.message}</span>
                  <small>{target?.text || target?.type || "document"}</small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

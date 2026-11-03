import { externalShareReview, type ShareGrant } from "./external-share";

/** Names of people outside the organization. Grant ids and file names stay off this note. */
export function ExternalShareNote({ grants, now }: { grants: readonly ShareGrant[]; now?: string }) {
  const review = externalShareReview(grants, now ?? new Date().toISOString());
  return (
    <section aria-label="External sharing">
      <h2>External sharing</h2>
      <p>{review.note}</p>
      {review.names.length ? (
        <ul>
          {review.names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

import { Link } from "react-router-dom";
import { adminDestination, documentLabel } from "./admin-model";

export function AdminLink({
  cluster,
  role,
}: {
  cluster: boolean;
  role?: string | null;
}) {
  if (adminDestination(cluster, role) !== "admin") return null;
  return (
    <Link className="admin-link" to="/admin">
      Admin
    </Link>
  );
}

export function DocumentTrail({
  entries,
}: {
  entries: { at: string; action: string; name: string }[];
}) {
  if (entries.length === 0) return <p>No documents opened or edited yet.</p>;
  return (
    <ul className="admin-list" aria-label="Documents">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${entry.action}-${index}`}>
          <span>{documentLabel(entry.action, entry.name)}</span>
          <small className="admin-muted">{entry.at}</small>
        </li>
      ))}
    </ul>
  );
}

export function CycleNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="admin-error" role="alert">
      {message}
    </p>
  );
}

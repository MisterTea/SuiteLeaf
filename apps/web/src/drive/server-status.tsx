import { StatusIcon } from "../status-icon";
import { syncSummary, type ServerSync } from "./status";

export function ServerStatusIcon({
  sync,
  host,
}: {
  sync: ServerSync | null;
  host: string;
}) {
  const label = sync
    ? (syncSummary(sync) ?? "SuiteDrive is reachable")
    : "SuiteDrive is unavailable";
  return (
    <span role="status">
      <StatusIcon
        state={!sync ? "offline" : sync.replicating ? "busy" : "connected"}
        label={label}
        detail={host}
      />
    </span>
  );
}


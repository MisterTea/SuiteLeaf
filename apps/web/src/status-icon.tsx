import {
  Check,
  CircleAlert,
  Cloud,
  CloudOff,
  Download,
  Info,
  LoaderCircle,
  Pencil,
  RefreshCw,
} from "lucide-react";

const icons = {
  saved: Check,
  connected: Cloud,
  offline: CloudOff,
  busy: LoaderCircle,
  pending: RefreshCw,
  editing: Pencil,
  error: CircleAlert,
  downloaded: Download,
  notice: Info,
};

export type StatusIconState = keyof typeof icons;

/** Status strings also contain recovery and import notices; keep those accessible. */
export function saveIconState(status: string): StatusIconState {
  if (
    /failed|newer version|conflict|could not|couldn't|cannot|can't|rejected|denied|not enough|full/i.test(
      status,
    )
  )
    return "error";
  if (/offline|unreachable|sign in|signed out/i.test(status)) return "offline";
  if (/not yet|pending|waiting/i.test(status)) return "pending";
  if (/saving|syncing/i.test(status)) return "busy";
  if (/unsaved|editing/i.test(status)) return "editing";
  if (/downloaded/i.test(status)) return "downloaded";
  if (/saved/i.test(status))
    return /Saved to SuiteDrive/.test(status) ? "connected" : "saved";
  return "notice";
}

export function StatusIcon({
  state,
  label,
  detail,
}: {
  state: StatusIconState;
  label: string;
  detail?: string;
}) {
  const Icon = icons[state];
  return (
    <span
      className={`status-icon status-icon-${state}`}
      title={detail ? `${label} · ${detail}` : label}
      tabIndex={0}
      data-state={state}
    >
      <Icon size={16} aria-hidden="true" />
      <span className="status-icon-label">{label}</span>
    </span>
  );
}

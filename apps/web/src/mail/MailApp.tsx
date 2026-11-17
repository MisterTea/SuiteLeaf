import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useMode } from "../mode";
import { getSession } from "../node-client";
import { SuperMailView } from "./SuperMailView";
import { ensureServerSupermailBridge } from "./server-supermail-bridge";
import "./mail.css";

export function MailRoute() {
  const { mode } = useMode();
  const session = getSession();

  useEffect(() => {
    if (mode.kind === "cluster" && session) {
      ensureServerSupermailBridge(session);
    }
  }, [mode, session]);

  const hasSupermail =
    typeof window !== "undefined" &&
    Boolean((window as unknown as { supermail?: unknown }).supermail);

  if (mode.kind === "cluster" || hasSupermail) {
    if (mode.kind === "cluster" && session && !hasSupermail) {
      ensureServerSupermailBridge(session);
    }
    return <SuperMailView />;
  }

  return (
    <main className="mail-unavailable">
      <h1>Mail requires server mode</h1>
      <p>Connect to a SuiteLeaf server to use email.</p>
      <Link to="/">Back to files</Link>
    </main>
  );
}

/**
 * In server mode, SuperMail replaces the legacy mail client.
 */
export const MailApp = SuperMailView;

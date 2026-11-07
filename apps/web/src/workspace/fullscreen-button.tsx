import { useEffect, useState } from "react";
import { Maximize, Minimize } from "lucide-react";

/** Fullscreen the document root so dialogs and the AI sidebar stay available. */
export function FullscreenButton() {
  const [active, setActive] = useState(() => !!document.fullscreenElement);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const supported =
    typeof document.documentElement.requestFullscreen === "function" &&
    typeof document.exitFullscreen === "function" &&
    document.fullscreenEnabled !== false;
  const label = active ? "Exit fullscreen" : "Enter fullscreen";

  useEffect(() => {
    const changed = () => setActive(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  async function toggle() {
    setError(false);
    setPending(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="doc-icon-btn"
        aria-label={label}
        aria-pressed={active}
        title={supported ? label : "Fullscreen is unavailable in this browser"}
        disabled={!supported || pending}
        onClick={() => void toggle()}
      >
        {active ? (
          <Minimize size={18} aria-hidden="true" />
        ) : (
          <Maximize size={18} aria-hidden="true" />
        )}
      </button>
      {error ? (
        <span role="alert">Could not change fullscreen. Please try again.</span>
      ) : null}
    </>
  );
}

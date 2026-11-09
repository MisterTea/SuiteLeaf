import { Download } from "lucide-react";
import { useId, useRef, useSyncExternalStore } from "react";
import "./install-button.css";

interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

let installPrompt: InstallPromptEvent | undefined;
let installed = false;
const standalone = window.matchMedia?.("(display-mode: standalone)");
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as InstallPromptEvent;
});
window.addEventListener("appinstalled", () => {
  installPrompt = undefined;
  installed = true;
  notify();
});
standalone?.addEventListener("change", notify);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function canInstall() {
  const ios = navigator as Navigator & { standalone?: boolean };
  return (
    !window.suiteleaf && !installed && !standalone?.matches && !ios.standalone
  );
}

export function InstallButton() {
  const visible = useSyncExternalStore(subscribe, canInstall);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  if (!visible) return null;

  async function install() {
    const prompt = installPrompt;
    installPrompt = undefined;
    if (prompt) {
      try {
        await prompt.prompt();
        return;
      } catch {
        // Use the browser menu if the saved prompt is no longer available.
      }
    }
    dialog.current?.showModal();
  }

  return (
    <>
      <button
        type="button"
        className="install-button"
        title="Install SuiteLeaf"
        aria-label="Install SuiteLeaf"
        onClick={() => void install()}
      >
        <Download size={16} aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        className="install-dialog"
        aria-labelledby={headingId}
      >
        <h2 id={headingId}>Install SuiteLeaf</h2>
        <ul>
          <li>
            <strong>Chrome or Edge on desktop</strong> — Use the install option
            in the address bar or browser menu.
          </li>
          <li>
            <strong>Safari on Mac</strong> — Choose File → Add to Dock.
          </li>
          <li>
            <strong>Chrome on Android</strong> — Open the browser menu and look
            for Install or Add to home screen.
          </li>
          <li>
            <strong>Safari on iPhone or iPad</strong> — Choose Share → Add to
            Home Screen and enable Open as Web App if shown.
          </li>
        </ul>
        <form method="dialog">
          <button type="submit">Close</button>
        </form>
      </dialog>
    </>
  );
}

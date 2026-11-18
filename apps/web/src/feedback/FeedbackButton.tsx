import { useState } from "react";
import { Bug } from "lucide-react";
import { captureCurrentScreenshot } from "./feedback-service";
import { FeedbackDialog } from "./FeedbackDialog";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [screenshot, setScreenshot] = useState("");
  const [capturing, setCapturing] = useState(false);

  async function handleClick() {
    if (capturing || open) return;
    setCapturing(true);
    try {
      const dataUrl = await captureCurrentScreenshot();
      setScreenshot(dataUrl);
      setOpen(true);
    } finally {
      setCapturing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="debug-button"
        aria-label="Report bug or request feature"
        title="Report a bug or request a feature"
        disabled={capturing}
        onClick={handleClick}
      >
        <Bug size={16} />
      </button>
      {open ? (
        <FeedbackDialog
          screenshot={screenshot}
          onClose={() => {
            setOpen(false);
            setScreenshot("");
          }}
        />
      ) : null}
    </>
  );
}

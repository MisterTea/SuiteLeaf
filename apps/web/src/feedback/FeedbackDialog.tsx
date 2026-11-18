import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { submitFeedbackIssue } from "./feedback-service";
import type { IssueResult } from "@suiteleaf/core";

export interface FeedbackDialogProps {
  screenshot: string;
  onClose: () => void;
}

export function FeedbackDialog({ screenshot, onClose }: FeedbackDialogProps) {
  const [type, setType] = useState<"bug" | "feature">("bug");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting]);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Please write a description before submitting.");
      textareaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await submitFeedbackIssue({
        type,
        text: trimmed,
        screenshotDataUrl: screenshot || undefined,
      });

      if (res.success) {
        setResult(res);
      } else {
        setError(res.error || "Failed to create issue. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="feedback-popover-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <div className="feedback-popover">
        <div className="feedback-popover-header">
          <h2 id="feedback-dialog-title">
            {type === "bug" ? "Report a Bug" : "Request a Feature"}
          </h2>
          <button
            type="button"
            className="close-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {result?.success ? (
          <div className="feedback-success">
            <p>
              Thanks! Your {type === "bug" ? "bug report" : "feature request"} was filed
              {result.number ? ` as #${result.number}` : ""}.
            </p>
            <div className="feedback-actions">
              <button
                type="button"
                className="dialog-primary-btn"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="feedback-thumbnail-wrapper">
              <label>Screenshot Preview</label>
              <div className="feedback-thumbnail-container">
                {screenshot ? (
                  <img
                    src={screenshot}
                    alt="Screenshot of current application window"
                    className="feedback-thumbnail"
                  />
                ) : (
                  <div className="feedback-no-screenshot">
                    No screenshot captured
                  </div>
                )}
              </div>
            </div>

            <div className="feedback-type-section">
              <span className="feedback-section-title">
                What are you reporting?
              </span>
              <div className="feedback-type-group" role="radiogroup">
                <label className="feedback-type-label">
                  <input
                    type="radio"
                    name="feedback-kind"
                    value="bug"
                    checked={type === "bug"}
                    onChange={() => setType("bug")}
                  />
                  Bug report
                </label>
                <label className="feedback-type-label">
                  <input
                    type="radio"
                    name="feedback-kind"
                    value="feature"
                    checked={type === "feature"}
                    onChange={() => setType("feature")}
                  />
                  New feature
                </label>
              </div>
            </div>

            <div className="feedback-textarea-section">
              <label htmlFor="feedback-textarea" className="feedback-section-title">
                {type === "bug" ? "Bug Details" : "Feature Details"}
              </label>
              <textarea
                id="feedback-textarea"
                ref={textareaRef}
                className={`feedback-textarea${error ? " has-error" : ""}`}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError("");
                }}
                placeholder={
                  type === "bug"
                    ? "What went wrong? Describe what you saw and what you expected."
                    : "Describe the feature you would like to see in SuiteLeaf."
                }
                rows={4}
                disabled={submitting}
                autoFocus
              />
              {error ? (
                <p className="feedback-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="feedback-actions">
              <button
                type="button"
                className="dialog-text-btn"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dialog-primary-btn"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

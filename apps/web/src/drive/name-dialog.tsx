import { useEffect, useRef, useState } from "react";
import { DriveDialog } from "./drive-dialog";

/** Ask for a folder or file name, optionally leaving its extension unselected. */
export function NameDialog({
  title,
  submitLabel,
  initial,
  keepExtension = false,
  maxLength,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial: string;
  keepExtension?: boolean;
  maxLength?: number;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const dot = initial.lastIndexOf(".");
    input.current?.focus();
    input.current?.setSelectionRange(
      0,
      keepExtension && dot > 0 ? dot : initial.length,
    );
  }, [initial, keepExtension]);
  const name = value.trim();
  return (
    <DriveDialog
      title={title}
      submitLabel={submitLabel}
      canSubmit={!!name}
      onSubmit={() => onSubmit(name)}
      onClose={onClose}
    >
      <div className="floating-field">
        <label htmlFor="drive-item-name">Name</label>
        <input
          id="drive-item-name"
          ref={input}
          value={value}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    </DriveDialog>
  );
}

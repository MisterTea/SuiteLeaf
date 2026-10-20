import { Type } from "lucide-react";
import type { ReactNode } from "react";

/** Font and size stay on the toolbar on a wide screen, and fold into this button on a phone. */
export function FontControls({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <details className="font-popover">
      <summary
        className="tool"
        aria-label="Font and size"
        title="Font and size"
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <Type size={16} aria-hidden="true" />
      </summary>
      <div className="font-popover-panel">{children}</div>
    </details>
  );
}

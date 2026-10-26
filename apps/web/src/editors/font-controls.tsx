import { Type } from "lucide-react";
import type { ReactNode } from "react";
import { useNarrowScreen } from "../ui";

/** Font and size stay on the toolbar on a wide screen, and fold into this button on a phone. */
export function FontControls({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const narrow = useNarrowScreen();
  // A closed <details> hides its content whatever the CSS says, so only a phone gets one.
  if (!narrow)
    return (
      <div className="font-popover">
        <div className="font-popover-panel">{children}</div>
      </div>
    );
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

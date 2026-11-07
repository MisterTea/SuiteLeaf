import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useReleaseActivation } from "./release-activation";

/** Keep a menu closed while a pointer is still choosing between a tap and a scroll. */
export function ReleaseDropdown({
  trigger,
  triggerProps,
  children,
}: {
  trigger: ReactNode;
  triggerProps: Pick<
    ComponentPropsWithoutRef<typeof Dropdown.Trigger>,
    "className" | "aria-label" | "title"
  >;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const activation = useReleaseActivation(() => setOpen((value) => !value));
  return (
    <Dropdown.Root open={open} onOpenChange={setOpen}>
      <Dropdown.Trigger
        {...triggerProps}
        {...activation}
        onPointerDown={(event) => {
          activation.onPointerDown(event);
          // Skip Radix's pointer-down toggle; the browser still handles panning.
          event.preventDefault();
        }}
      >
        {trigger}
      </Dropdown.Trigger>
      {children}
    </Dropdown.Root>
  );
}

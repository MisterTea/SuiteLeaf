import { createContext, type RefCallback } from "react";

/** Editors can anchor workspace notifications to their content area. */
export const EditorStatusTarget = createContext<RefCallback<HTMLDivElement> | null>(null);

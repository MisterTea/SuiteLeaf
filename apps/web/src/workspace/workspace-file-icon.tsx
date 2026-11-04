import { ClipboardList } from "lucide-react";
import type { SuiteFile } from "@suiteleaf/core";
import { DrawingIcon } from "../drawing-home";

export function WorkspaceFileIcon({ kind }: { kind: SuiteFile["kind"] }) {
  return (
    <span className={`file-icon ${kind}`}>
      {kind === "form" ? (
        <ClipboardList size={22} color="#7b1fa2" aria-hidden="true" />
      ) : kind === "drawing" ? (
        <DrawingIcon size={22} />
      ) : kind === "doc" ? (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"
            fill="#4285F4"
          />
          <path d="M14 2V8H20L14 2Z" fill="#A1C2FA" />
          <path
            d="M8 12H16V13.6H8V12ZM8 15.2H16V16.8H8V15.2ZM8 18.4H13V20H8V18.4Z"
            fill="#FFFFFF"
          />
        </svg>
      ) : kind === "sheet" ? (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"
            fill="#0F9D58"
          />
          <path d="M14 2V8H20L14 2Z" fill="#87CEAC" />
          <path d="M8 11.5H16V18.5H8V11.5Z" fill="#0F9D58" />
          <path
            d="M8 11.5H16V18.5H8V11.5ZM8 13.8H16M8 16.2H16M12 11.5V18.5"
            stroke="#FFFFFF"
            strokeWidth="1.2"
          />
        </svg>
      ) : (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"
            fill="#F4B400"
          />
          <path d="M14 2V8H20L14 2Z" fill="#FCE293" />
          <rect
            x="7.5"
            y="11.5"
            width="9"
            height="7"
            rx="0.5"
            fill="#FFFFFF"
          />
        </svg>
      )}
    </span>
  );
}

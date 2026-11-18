import type { Layout } from "./slide-layouts";

/** Miniature visual wireframe of a slide layout for dropdown menus and pickers. */
export function SlideLayoutThumbnail({
  layout,
  className = "",
}: {
  layout: Layout | "three-column";
  className?: string;
}) {
  return (
    <svg
      className={`layout-menu-thumbnail ${className}`}
      width="24"
      height="16"
      viewBox="0 0 24 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Slide background card */}
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="15"
        rx="2"
        fill={layout === "section" ? "#1e293b" : "var(--surface, #ffffff)"}
        stroke={layout === "section" ? "#334155" : "var(--border, #dadce0)"}
        strokeWidth="1"
      />
      {layout === "title-body" && (
        <>
          <rect x="3" y="3" width="10" height="2" rx="0.5" fill="var(--google-blue, #1a73e8)" />
          <line x1="3" y1="7" x2="21" y2="7" stroke="var(--text-secondary, #9aa0a6)" strokeWidth="1" strokeLinecap="round" />
          <line x1="3" y1="9.5" x2="19" y2="9.5" stroke="var(--text-secondary, #9aa0a6)" strokeWidth="1" strokeLinecap="round" />
          <line x1="3" y1="12" x2="15" y2="12" stroke="var(--text-secondary, #9aa0a6)" strokeWidth="1" strokeLinecap="round" />
        </>
      )}
      {layout === "title" && (
        <>
          <rect x="4" y="5.5" width="16" height="2.5" rx="0.5" fill="var(--google-blue, #1a73e8)" />
          <rect x="6" y="9.5" width="12" height="1.5" rx="0.5" fill="var(--text-secondary, #9aa0a6)" />
        </>
      )}
      {layout === "two-column" && (
        <>
          <rect x="3" y="3" width="10" height="1.8" rx="0.5" fill="var(--google-blue, #1a73e8)" />
          <rect x="3" y="6" width="8" height="7" rx="1" fill="none" stroke="var(--text-secondary, #9aa0a6)" strokeWidth="0.8" strokeDasharray="1.5 1" />
          <rect x="13" y="6" width="8" height="7" rx="1" fill="none" stroke="var(--text-secondary, #9aa0a6)" strokeWidth="0.8" strokeDasharray="1.5 1" />
        </>
      )}
      {layout === "three-column" && (
        <>
          <rect x="3" y="3" width="10" height="1.8" rx="0.5" fill="var(--google-blue, #1a73e8)" />
          <rect x="3" y="6" width="5" height="7" rx="1" fill="none" stroke="var(--text-secondary, #9aa0a6)" strokeWidth="0.8" strokeDasharray="1.5 1" />
          <rect x="9.5" y="6" width="5" height="7" rx="1" fill="none" stroke="var(--text-secondary, #9aa0a6)" strokeWidth="0.8" strokeDasharray="1.5 1" />
          <rect x="16" y="6" width="5" height="7" rx="1" fill="none" stroke="var(--text-secondary, #9aa0a6)" strokeWidth="0.8" strokeDasharray="1.5 1" />
        </>
      )}
      {layout === "section" && (
        <>
          <rect x="5" y="7" width="14" height="2" rx="0.5" fill="#f8fafc" />
        </>
      )}
      {layout === "blank" && (
        <rect
          x="2.5"
          y="2.5"
          width="19"
          height="11"
          rx="1"
          fill="none"
          stroke="var(--border, #dadce0)"
          strokeWidth="0.8"
          strokeDasharray="2 1.5"
        />
      )}
    </svg>
  );
}

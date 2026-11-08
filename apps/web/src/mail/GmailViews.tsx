import type { Folder } from "./client";
export function GmailViews({
  folders,
  onView,
  disabled,
}: {
  folders: Folder[];
  onView: (folder: string, query: string) => void;
  disabled: boolean;
}) {
  const all = folders.find((f) => f.specialUse === "\\All")?.path || "INBOX";
  return (
    <nav className="mail-category-tabs" aria-label="Gmail inbox views">
      {["primary", "social", "promotions", "updates", "forums"].map(
        (category) => (
          <button
            key={category}
            disabled={disabled}
            onClick={() => onView("INBOX", `category:${category}`)}
          >
            {category[0].toUpperCase() + category.slice(1)}
          </button>
        ),
      )}
      <button disabled={disabled} onClick={() => onView(all, "is:starred")}>
        Starred
      </button>
      <button disabled={disabled} onClick={() => onView(all, "is:important")}>
        Important
      </button>
      <button disabled={disabled} onClick={() => onView(all, "")}>
        All mail
      </button>
    </nav>
  );
}

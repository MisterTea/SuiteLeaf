import { useState } from "react";
import { monthGrid } from "./share-expiry";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Pick the day access ends. Choosing a day applies it; there is no Save. */
export function ExpiryCalendar({
  person,
  onPick,
  onClose,
}: {
  person: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const [anchor, setAnchor] = useState(() => new Date());
  const days = monthGrid(anchor);
  const title = anchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const shift = (months: number) =>
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + months, 1));
  return (
    <div className="share-expiry" role="group" aria-label={`Access ends for ${person}`}>
      <div className="share-expiry-head">
        <strong>{person}&apos;s access ends</strong>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="share-expiry-nav">
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)}>
          ‹
        </button>
        <span>{title}</span>
        <button type="button" aria-label="Next month" onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="share-expiry-week" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="share-expiry-grid">
        {days.map((day) => (
          <button
            key={day.iso}
            type="button"
            disabled={day.disabled}
            aria-label={day.label}
            className={day.inMonth ? undefined : "outside"}
            onClick={() => onPick(day.iso)}
          >
            {day.number}
          </button>
        ))}
      </div>
      <p className="share-expiry-note">It takes effect as soon as you pick a day.</p>
    </div>
  );
}
